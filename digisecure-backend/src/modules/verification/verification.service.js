const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const Document = require("../../models/Document.model");
const VerificationAttempt = require("../../models/VerificationAttempt.model");
const User = require("../../models/User.model");
const { env } = require("../../config/env");
const { verifyPayload } = require("../../crypto/documentSigner");
const { canonicalize } = require("../../pdf-pipeline/pdfCanonicalizer");
const { parsePdfWithPositions } = require("../../pdf-pipeline/pdfParser");
const { diffTokenStreams } = require("../../pdf-pipeline/pdfDiffer");
const { comparePdfVisualLayers } = require("../../pdf-pipeline/pdfVisualDiff");
const { mapChangedWordsToRectangles } = require("../../pdf-pipeline/tamperMapper");
const { sha256 } = require("../../pdf-pipeline/pdfHasher");
const { getPdfPositions, setPdfPositions } = require("../../cache/pdfPositionCache");
const { getDocumentSnapshot, setDocumentSnapshot } = require("../../cache/documentSnapshotCache");
const { getTrustScore } = require("../../cache/trustCache");
const { appendAuditEntry } = require("../audit-ledger/auditLedger.service");
const { recomputeTrustScore } = require("../trust-score/trustScore.service");
const { buildIssuanceHashes, buildSignaturePayload } = require("../issuance/issuance.service");
const {
  getVerifyJob,
  setVerifyJob,
  setVerifyJobIfAbsent,
  getVerifyJobPayload,
  setVerifyJobPayload,
  deleteVerifyJobPayload,
  enqueueVerifyJob
} = require("../../cache/verifyJobCache");
const { AppError } = require("../../utils/AppError");
const { diffArrays } = require("diff");
const { extractOcrLayer, compareOcrLayers } = require("./ocr.service");

const ASYNC_UPLOAD_SIZE_THRESHOLD_BYTES = 5 * 1024 * 1024;
const DETECTOR_ASYNC_SIZE_THRESHOLD_BYTES = 2 * 1024 * 1024;

function withTimeout(promise, timeoutMs, timeoutMessage) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        const error = new Error(timeoutMessage || "Detector timed out");
        error.code = "DETECTOR_TIMEOUT";
        reject(error);
      }, timeoutMs);
    })
  ]);
}

function getDefaultDetectors() {
  return {
    textLayerChanged: false,
    ocrLayerChanged: false,
    visualLayerChanged: false
  };
}

function getDefaultOcrDiffSummary() {
  return {
    changedWordCount: 0,
    changedPages: [],
    confidence: null
  };
}

function mergeChangedPages(...lists) {
  const merged = new Set();

  for (const list of lists) {
    for (const page of Array.isArray(list) ? list : []) {
      const normalized = Number(page);

      if (Number.isFinite(normalized) && normalized > 0) {
        merged.add(normalized);
      }
    }
  }

  return [...merged].sort((left, right) => left - right);
}

function mergeRectanglesByPage(...sources) {
  const merged = {};

  for (const source of sources) {
    if (!source || typeof source !== "object") {
      continue;
    }

    for (const [page, rectangles] of Object.entries(source)) {
      const normalized = Array.isArray(rectangles) ? rectangles : [];

      if (!merged[page]) {
        merged[page] = [];
      }

      merged[page].push(
        ...normalized.map((rectangle) => ({
          x: Number(rectangle.x || 0),
          y: Number(rectangle.y || 0),
          width: Number(rectangle.width || 0),
          height: Number(rectangle.height || 0),
          ...(rectangle.text ? { text: rectangle.text } : {}),
          ...(rectangle.source ? { source: rectangle.source } : {})
        }))
      );
    }
  }

  return merged;
}

async function readIssuedPdfBuffer(document) {
  const issuedPath = document?.issuedPdfStorage?.path;

  if (!issuedPath) {
    return null;
  }

  const absolutePath = path.resolve(process.cwd(), issuedPath);
  return fs.readFile(absolutePath);
}

function hashIp(ip) {
  return crypto.createHash("sha256").update(String(ip)).digest("hex");
}

function hashResultToken(token) {
  return token ? sha256(`result:${token}`) : null;
}

function createResultAccessToken() {
  return crypto.randomBytes(24).toString("hex");
}

function buildAnonymousSessionId(ip, userAgent) {
  return sha256(`${String(ip || "unknown")}|${String(userAgent || "unknown")}`);
}

function buildVerificationJobId({ documentId, uploadedFileHash }) {
  return `verify_${sha256(`${documentId}:${uploadedFileHash}`).slice(0, 24)}`;
}

function buildPendingJobResponse({ jobId, documentId }) {
  return {
    status: "pending",
    reasonCode: "VERIFICATION_JOB_PENDING",
    reason: "Verification job is still processing",
    jobId,
    documentId
  };
}

function sanitizeAttemptForResponse(attempt) {
  if (!attempt) {
    return attempt;
  }

  const plain = typeof attempt.toObject === "function" ? attempt.toObject() : { ...attempt };
  delete plain.publicResultTokenHash;

  return plain;
}

function sanitizeJobForResponse(job) {
  if (!job) {
    return job;
  }

  const plain = { ...job };
  delete plain.resultAccessTokenHash;

  return plain;
}

function canAccessProtectedResult({ auth, tenantId, verifierUserId, resultToken, resultAccessTokenHash }) {
  if (auth?.role === "platform_admin") {
    return true;
  }

  if (auth?.userId && verifierUserId && String(auth.userId) === String(verifierUserId)) {
    return true;
  }

  if (
    auth?.tenantId &&
    tenantId &&
    String(auth.tenantId) === String(tenantId) &&
    ["institution_admin", "institution_operator"].includes(auth.role)
  ) {
    return true;
  }

  if (resultToken && resultAccessTokenHash && hashResultToken(resultToken) === resultAccessTokenHash) {
    return true;
  }

  return false;
}

function resolveUploadRequestContext(req) {
  const body = req.validated?.body || req.body || {};
  const qrPayload = parseQrPayloadInput(body.qrPayload);
  const documentId = body.documentId || qrPayload?.documentId;
  const verifierUserId = req.auth?.userId || null;
  const file = req.file;

  if (!file?.buffer || !file.size) {
    throw new AppError("PDF file is required", 400);
  }

  if (file.mimetype !== "application/pdf") {
    throw new AppError("Only PDF uploads are allowed", 400);
  }

  if (!documentId) {
    throw new AppError("documentId or qrPayload is required", 400);
  }

  if (body.documentId && qrPayload?.documentId && body.documentId !== qrPayload.documentId) {
    throw new AppError("documentId and qrPayload.documentId do not match", 400);
  }

  return {
    body,
    qrPayload,
    documentId,
    auth: req.auth || null,
    verifierUserId,
    file,
    uploadedFileHash: sha256(file.buffer)
  };
}

async function scheduleVerificationJob({ jobId, documentId, executionPromise, metadata = {} }) {
  const queuedAt = new Date().toISOString();
  const pendingJob = {
    jobId,
    documentId,
    status: "pending",
    ...metadata,
    queuedAt
  };
  const requestPayload = {
    request: {
      ip: executionPromise.req.ip,
      userAgent: executionPromise.req.headers["user-agent"] || null
    },
    context: {
      ...executionPromise.context,
      file: {
        originalname: executionPromise.context.file.originalname || null,
        mimetype: executionPromise.context.file.mimetype,
        size: Number(executionPromise.context.file.size) || executionPromise.context.file.buffer.length,
        bufferBase64: executionPromise.context.file.buffer.toString("base64")
      }
    }
  };

  const created = await setVerifyJobIfAbsent(jobId, pendingJob);

  if (!created) {
    await setVerifyJob(jobId, pendingJob);
  }

  try {
    await setVerifyJobPayload(jobId, requestPayload);
    await enqueueVerifyJob(jobId);
  } catch (error) {
    await setVerifyJob(jobId, {
      ...pendingJob,
      status: "error",
      completedAt: new Date().toISOString(),
      error: {
        message: error?.message || "Failed to enqueue verification job",
        statusCode: error?.statusCode || 500
      }
    });
    throw error;
  }
}

function buildQueueExecutionInput(payload) {
  const file = payload?.context?.file || {};
  const buffer = Buffer.from(String(file.bufferBase64 || ""), "base64");

  if (!buffer.length) {
    throw new AppError("Verification job payload is missing upload buffer", 500);
  }

  return {
    req: {
      ip: payload?.request?.ip || "unknown",
      headers: {
        "user-agent": payload?.request?.userAgent || null
      }
    },
    context: {
      ...payload.context,
      file: {
        originalname: file.originalname || null,
        mimetype: file.mimetype || "application/pdf",
        size: Number(file.size) || buffer.length,
        buffer
      }
    }
  };
}

async function processQueuedVerificationJob(jobId) {
  const job = await getVerifyJob(jobId);

  if (!job || job.status !== "pending") {
    return null;
  }

  const payload = await getVerifyJobPayload(jobId);

  if (!payload) {
    await setVerifyJob(jobId, {
      ...job,
      status: "error",
      completedAt: new Date().toISOString(),
      error: {
        message: "Verification job payload was not found",
        statusCode: 500
      }
    });
    return null;
  }

  try {
    const { req, context } = buildQueueExecutionInput(payload);
    const result = await performUploadVerification(req, context);

    await setVerifyJob(jobId, {
      ...job,
      status: "completed",
      completedAt: new Date().toISOString(),
      result
    });
    await deleteVerifyJobPayload(jobId);
    return result;
  } catch (error) {
    await setVerifyJob(jobId, {
      ...job,
      status: "error",
      completedAt: new Date().toISOString(),
      error: {
        message: error?.message || "Verification job failed",
        statusCode: error?.statusCode || 500
      }
    });
    return null;
  }
}

function flattenWordPositions(textPositions = []) {
  return textPositions
    .flatMap((page) => {
      const pageNumber = Number(page?.pageNumber) || 1;
      const words = Array.isArray(page?.words) ? page.words : [];

      return words.map((word) => ({
        pageNumber,
        text: word.text,
        normalizedText: word.normalizedText,
        x: word.x,
        y: word.y,
        width: word.width,
        height: word.height,
        readingOrderIndex: word.readingOrderIndex
      }));
    })
    .filter((word) => typeof word.normalizedText === "string" && word.normalizedText.length > 0)
    .sort((left, right) => {
      if (left.pageNumber !== right.pageNumber) {
        return left.pageNumber - right.pageNumber;
      }

      return (left.readingOrderIndex || 0) - (right.readingOrderIndex || 0);
    });
}

function parseQrPayloadInput(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "object") {
    return value;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (error) {
      throw new AppError("qrPayload must be valid JSON", 400);
    }
  }

  throw new AppError("qrPayload is invalid", 400);
}

function buildDocumentLifecycleStatus(status, expiresAt) {
  if (status === "revoked") {
    return {
      status: "revoked",
      reasonCode: "DOCUMENT_REVOKED",
      reason: "Document has been revoked"
    };
  }

  if (status === "superseded") {
    return {
      status: "revoked",
      reasonCode: "DOCUMENT_SUPERSEDED",
      reason: "Document has been superseded"
    };
  }

  if (status === "expired" || (expiresAt && new Date(expiresAt).getTime() < Date.now())) {
    return {
      status: "revoked",
      reasonCode: "DOCUMENT_REVOKED",
      reason: "Document is expired"
    };
  }

  return null;
}

function verifyQrPayloadAgainstSnapshot(qrPayload, snapshot) {
  if (!qrPayload) {
    return { valid: true, reasonCode: null, reason: null, signatureValid: null };
  }

  const verificationBasis = {
    documentId: qrPayload.documentId,
    tenantId: qrPayload.tenantId,
    signatureId: qrPayload.signatureId,
    contentHash: qrPayload.contentHash,
    verificationToken: qrPayload.verificationToken,
    issuedAt: qrPayload.issuedAt
  };

  const qrSignatureValid = verifyPayload(
    canonicalize(verificationBasis),
    qrPayload.qrSignature,
    snapshot.issuerPublicKeyPem
  );

  if (!qrSignatureValid) {
    return {
      valid: false,
      reasonCode: "QR_SIGNATURE_INVALID",
      reason: "QR signature could not be validated",
      signatureValid: false
    };
  }

  if (snapshot.verificationToken !== qrPayload.verificationToken) {
    return {
      valid: false,
      reasonCode: "TOKEN_INVALID",
      reason: "Verification token does not match the issued record",
      signatureValid: true
    };
  }

  if (snapshot.canonicalContentHash !== qrPayload.contentHash) {
    return {
      valid: false,
      reasonCode: "CONTENT_HASH_MISMATCH",
      reason: "QR content hash does not match the stored document",
      signatureValid: true
    };
  }

  return { valid: true, reasonCode: null, reason: null, signatureValid: true };
}

function compareWordStreams(originalWords, candidateWords) {
  const originalTokens = originalWords.map((word) => word.normalizedText);
  const candidateTokens = candidateWords.map((word) => word.normalizedText);
  const chunks = diffArrays(originalTokens, candidateTokens);
  const changedOriginal = [];
  const changedCandidate = [];
  const changedPages = new Set();

  let originalCursor = 0;
  let candidateCursor = 0;

  for (const chunk of chunks) {
    const valuesLength = Array.isArray(chunk.value) ? chunk.value.length : 0;

    if (chunk.added) {
      for (let index = 0; index < valuesLength; index += 1) {
        const candidateWord = candidateWords[candidateCursor + index];
        if (candidateWord) {
          changedCandidate.push(candidateWord);
          changedPages.add(candidateWord.pageNumber);
        }
      }

      candidateCursor += valuesLength;
      continue;
    }

    if (chunk.removed) {
      for (let index = 0; index < valuesLength; index += 1) {
        const originalWord = originalWords[originalCursor + index];
        if (originalWord) {
          changedOriginal.push(originalWord);
          changedPages.add(originalWord.pageNumber);
        }
      }

      originalCursor += valuesLength;
      continue;
    }

    originalCursor += valuesLength;
    candidateCursor += valuesLength;
  }

  return {
    changedOriginal,
    changedCandidate,
    changedPages: [...changedPages].sort((left, right) => left - right)
  };
}

function buildUploadBodyFromDocument(document) {
  return {
    title: document.title,
    documentType: document.documentType,
    recipientName: document.recipientName,
    recipientReference: document.recipientReference || null,
    expiresAt: document.expiresAt || null,
    metadata: document.customMetadata || {}
  };
}

function buildSignatureVerification(document, snapshot) {
  const issuerPublicKeyPem = snapshot.issuerPublicKeyPem || null;
  const publicKeyFingerprint = issuerPublicKeyPem ? sha256(issuerPublicKeyPem) : null;
  const canVerifyWithCurrentKey = issuerPublicKeyPem && publicKeyFingerprint === document.signingKeyFingerprint;

  if (!canVerifyWithCurrentKey) {
    return {
      signatureValid: null,
      expectedKeyFingerprint: document.signingKeyFingerprint,
      providedSignatureId: document.signatureId
    };
  }

  const signaturePayload = buildSignaturePayload({
    documentId: document.documentId,
    tenantId: document.tenantId,
    issuerUserId: String(document.issuerUserId),
    issuedAt: new Date(document.issuedAt).toISOString(),
    signatureId: document.signatureId,
    verificationToken: document.verificationToken,
    metadataHash: document.metadataHash,
    canonicalContentHash: document.canonicalContentHash,
    fileBinaryHash: document.fileBinaryHash,
    signingKeyFingerprint: document.signingKeyFingerprint
  });

  return {
    signatureValid: verifyPayload(canonicalize(signaturePayload), document.signatureValue, issuerPublicKeyPem),
    expectedKeyFingerprint: document.signingKeyFingerprint,
    providedSignatureId: document.signatureId
  };
}

async function resolveDocumentSnapshot({ documentId }) {
  const cached = await getDocumentSnapshot(documentId);
  if (cached) return cached;

  const document = await Document.findOne({ documentId }).lean();
  if (!document) return null;

  const issuer = await User.findById(document.issuerUserId).lean();
  const snapshot = {
    documentId: document.documentId,
    tenantId: document.tenantId,
    status: document.status,
    canonicalContentHash: document.canonicalContentHash,
    verificationToken: document.verificationToken,
    issuerUserId: String(document.issuerUserId),
    issuerInstitutionName: document.issuerInstitutionName,
    qrPayload: document.qrPayload,
    signingKeyFingerprint: document.signingKeyFingerprint,
    issuerPublicKeyPem: issuer?.rsaPublicKeyPem || null
  };

  await setDocumentSnapshot(documentId, snapshot);
  return snapshot;
}

async function resolveDocumentOcrBaseline(document) {
  if (document?.ocrBaseline && (document.ocrBaseline.enabled || !env.OCR_ENABLED)) {
    return document.ocrBaseline;
  }

  try {
    const issuedPdfBuffer = await readIssuedPdfBuffer(document);

    if (!issuedPdfBuffer) {
      return null;
    }

    const issuedFileHash = sha256(issuedPdfBuffer);
    const ocrBaseline = await extractOcrLayer({
      documentId: document.documentId,
      fileHash: issuedFileHash,
      pdfBuffer: issuedPdfBuffer,
      useCache: true
    });
    const baselinePayload = {
      ...ocrBaseline,
      fileHash: issuedFileHash,
      source: "issued_pdf"
    };

    await Document.updateOne(
      { documentId: document.documentId },
      {
        $set: {
          ocrBaseline: baselinePayload
        }
      }
    );

    return baselinePayload;
  } catch (_error) {
    return null;
  }
}

async function createVerificationAttempt(payload) {
  return VerificationAttempt.create(payload);
}

async function verifyQrPayload({ qrPayload, ip, userAgent, verifierUserId = null }) {
  const isAnonymous = !verifierUserId;
  const resultAccessToken = isAnonymous ? createResultAccessToken() : null;
  const publicResultTokenHash = hashResultToken(resultAccessToken);
  const anonymousSessionId = isAnonymous ? buildAnonymousSessionId(ip, userAgent) : null;
  const snapshot = await resolveDocumentSnapshot({ documentId: qrPayload.documentId });
  const receivedAt = new Date();

  if (!snapshot) {
    const attempt = await createVerificationAttempt({
      attemptId: uuidv4(),
      method: "qr",
      requestIpHash: hashIp(ip),
      userAgent,
      requestReceivedAt: receivedAt,
      completedAt: new Date(),
      latencyMs: 0,
      resultStatus: "not_found",
      resultReasonCode: "DOCUMENT_NOT_FOUND",
      resultMessage: "Document could not be found",
      qrPayloadReceived: qrPayload,
      verifierUserId,
      anonymousSessionId,
      publicResultTokenHash
    });

    return {
      attempt: sanitizeAttemptForResponse(attempt),
      result: sanitizeAttemptForResponse(attempt),
      ...(resultAccessToken ? { resultAccessToken } : {})
    };
  }

  const verificationBasis = {
    documentId: qrPayload.documentId,
    tenantId: qrPayload.tenantId,
    signatureId: qrPayload.signatureId,
    contentHash: qrPayload.contentHash,
    verificationToken: qrPayload.verificationToken,
    issuedAt: qrPayload.issuedAt
  };

  const qrSignatureValid = verifyPayload(
    canonicalize(verificationBasis),
    qrPayload.qrSignature,
    snapshot.issuerPublicKeyPem
  );

  let resultStatus = "verified";
  let resultReasonCode = "VERIFIED";
  let resultMessage = "Document is verified";

  if (!qrSignatureValid) {
    resultStatus = "suspicious";
    resultReasonCode = "QR_SIGNATURE_INVALID";
    resultMessage = "QR signature could not be validated";
  } else if (snapshot.verificationToken !== qrPayload.verificationToken) {
    resultStatus = "suspicious";
    resultReasonCode = "TOKEN_INVALID";
    resultMessage = "Verification token does not match the issued record";
  } else if (snapshot.canonicalContentHash !== qrPayload.contentHash) {
    resultStatus = "suspicious";
    resultReasonCode = "CONTENT_HASH_MISMATCH";
    resultMessage = "QR content hash does not match the stored document";
  } else if (snapshot.status === "revoked" || snapshot.status === "superseded") {
    resultStatus = "revoked";
    resultReasonCode = "DOCUMENT_REVOKED";
    resultMessage = "Document has been revoked or superseded";
  }

  const trustSummary = snapshot.issuerUserId ? await getTrustScore(snapshot.issuerUserId) : null;
  const completedAt = new Date();
  const attempt = await createVerificationAttempt({
    attemptId: uuidv4(),
    tenantId: snapshot.tenantId,
    documentId: snapshot.documentId,
    issuerUserId: snapshot.issuerUserId,
    verifierUserId,
    method: "qr",
    requestIpHash: hashIp(ip),
    userAgent,
    requestReceivedAt: receivedAt,
    completedAt,
    latencyMs: completedAt.getTime() - receivedAt.getTime(),
    resultStatus,
    resultReasonCode,
    resultMessage,
    qrPayloadReceived: qrPayload,
    anonymousSessionId,
    publicResultTokenHash,
    signatureVerification: {
      signatureValid: qrSignatureValid,
      expectedKeyFingerprint: snapshot.signingKeyFingerprint,
      providedSignatureId: qrPayload.signatureId
    }
  });

  await appendAuditEntry({
    tenantId: snapshot.tenantId,
    action: "DOCUMENT_VERIFIED_QR",
    documentId: snapshot.documentId,
    actorId: verifierUserId || "anonymous",
    actorType: verifierUserId ? "verifier_user" : "anonymous",
    payload: {
      attemptId: attempt.attemptId,
      resultStatus,
      resultReasonCode
    }
  });

  if (snapshot.issuerUserId) {
    await recomputeTrustScore({
      issuerUserId: snapshot.issuerUserId,
      triggerType: "verification",
      triggerRef: attempt.attemptId
    });
  }

  return {
    attempt: sanitizeAttemptForResponse(attempt),
    result: {
      status: resultStatus,
      reasonCode: resultReasonCode,
      reason: resultMessage,
      documentId: snapshot.documentId,
      issuerInstitutionName: snapshot.issuerInstitutionName,
      trustScore: trustSummary
    },
    ...(resultAccessToken ? { resultAccessToken } : {})
  };
}

async function performUploadVerification(req, context = null) {
  const receivedAt = new Date();
  const {
    body,
    qrPayload,
    documentId,
    verifierUserId,
    file,
    uploadedFileHash,
    resultAccessToken,
    publicResultTokenHash,
    anonymousSessionId
  } = context || resolveUploadRequestContext(req);
  const snapshot = await resolveDocumentSnapshot({ documentId });

  if (!snapshot) {
    const attempt = await createVerificationAttempt({
      attemptId: uuidv4(),
      method: "upload",
      requestIpHash: hashIp(req.ip),
      userAgent: req.headers["user-agent"] || null,
      verifierUserId,
      requestFileName: file.originalname || null,
      requestFileSizeBytes: file.size,
      requestReceivedAt: receivedAt,
      completedAt: new Date(),
      latencyMs: 0,
      resultStatus: "not_found",
      resultReasonCode: "DOCUMENT_NOT_FOUND",
      resultMessage: "Document could not be found",
      qrPayloadReceived: qrPayload,
      uploadedFileHash,
      anonymousSessionId,
      publicResultTokenHash
    });

    return {
      attempt: sanitizeAttemptForResponse(attempt),
      result: {
        status: "not_found",
        reasonCode: "DOCUMENT_NOT_FOUND",
        reason: "Document could not be found",
        documentId,
        issuerInstitutionName: null,
        trustScore: null,
        detectors: getDefaultDetectors(),
        visualDiffScoreByPage: [],
        ocrDiffSummary: getDefaultOcrDiffSummary(),
        tamperFindings: null
      },
      ...(resultAccessToken ? { resultAccessToken } : {})
    };
  }

  const document = await Document.findOne({ documentId }).lean();

  if (!document) {
    throw new AppError("Document could not be found", 404);
  }

  const qrCheck = verifyQrPayloadAgainstSnapshot(qrPayload, snapshot);
  const lifecycleStatus = buildDocumentLifecycleStatus(document.status, document.expiresAt);

  let parsedUpload = await getPdfPositions(documentId, uploadedFileHash);

  if (!parsedUpload || !Array.isArray(parsedUpload.textPositions)) {
    parsedUpload = await parsePdfWithPositions(file.buffer);
    await setPdfPositions(documentId, uploadedFileHash, {
      extractedTextVersion: 1,
      pageCount: parsedUpload.pageCount,
      textPositions: parsedUpload.textPositions,
      metadata: parsedUpload.metadata,
      fullText: parsedUpload.fullText,
      pageText: parsedUpload.pageText
    });
  }

  const candidateHashes = buildIssuanceHashes({
    body: buildUploadBodyFromDocument(document),
    parsedPdf: parsedUpload
  });
  const metadataHashMatch = candidateHashes.metadataHash === document.metadataHash;
  const canonicalHashMatch = candidateHashes.canonicalContentHash === document.canonicalContentHash;
  const pageCountMatch = Number(parsedUpload.pageCount) === Number(document.pageCount);
  const issuedFileHash =
    typeof document?.ocrBaseline?.fileHash === "string" && document.ocrBaseline.fileHash.length
      ? document.ocrBaseline.fileHash
      : null;
  const issuedBinaryHashMatch = issuedFileHash ? issuedFileHash === uploadedFileHash : null;

  const originalWords = flattenWordPositions(document.textPositions || []);
  const candidateWords = flattenWordPositions(parsedUpload.textPositions || []);
  const streamDiff = compareWordStreams(originalWords, candidateWords);
  const textualDiff = diffTokenStreams(
    originalWords.map((word) => word.normalizedText).join(" "),
    candidateWords.map((word) => word.normalizedText).join(" ")
  );
  const tokenDiffDetected = streamDiff.changedOriginal.length > 0 || streamDiff.changedCandidate.length > 0;
  const textDiffDetected = tokenDiffDetected || textualDiff.some((part) => part.added || part.removed);

  const ocrBaseline = await resolveDocumentOcrBaseline(document);
  const candidateOcr = await extractOcrLayer({
    documentId,
    fileHash: uploadedFileHash,
    parsedPdf: parsedUpload,
    pdfBuffer: file.buffer,
    useCache: true
  });
  const ocrComparison = compareOcrLayers({
    baseline: ocrBaseline,
    candidate: candidateOcr
  });
  const ocrDiffSummary = {
    changedWordCount: Number(ocrComparison.changedWordCount) || 0,
    changedPages: Array.isArray(ocrComparison.changedPages) ? ocrComparison.changedPages : [],
    confidence: Number.isFinite(ocrComparison.confidence) ? ocrComparison.confidence : null
  };
  const ocrLayerChanged =
    ocrComparison.available &&
    (ocrDiffSummary.changedWordCount > 0 || ocrDiffSummary.changedPages.length > 0);

  let visualDiffScoreByPage = [];
  let visualChangedPages = [];
  let visualRectanglesByPage = {};
  let visualLayerChanged = false;
  let visualDetectorError = null;
  let visualBaselineAvailable = false;

  if (env.VISUAL_DIFF_ENABLED) {
    try {
      const baselinePdfBuffer = await readIssuedPdfBuffer(document);

      if (baselinePdfBuffer?.length) {
        visualBaselineAvailable = true;
        const visualComparison = await withTimeout(
          comparePdfVisualLayers({
            baselinePdfBuffer,
            candidatePdfBuffer: file.buffer,
            threshold: env.VISUAL_DIFF_THRESHOLD,
            minChangedOps: env.VISUAL_DIFF_MIN_CHANGED_OPS,
            minChangedSensitiveOps: env.VISUAL_DIFF_MIN_CHANGED_SENSITIVE_OPS
          }),
          env.VISUAL_DIFF_TIMEOUT_MS,
          "Visual diff detector timed out"
        );

        visualDiffScoreByPage = visualComparison.visualDiffScoreByPage || [];
        visualChangedPages = visualComparison.changedPages || [];
        visualRectanglesByPage = visualComparison.visualRectanglesByPage || {};
        visualLayerChanged = Boolean(visualComparison.visualLayerChanged);
      }
    } catch (error) {
      visualDetectorError = error?.message || "Visual detector failed";
      visualDiffScoreByPage = [];
      visualChangedPages = [];
      visualRectanglesByPage = {};
      visualLayerChanged = false;
    }
  }

  const detectors = {
    textLayerChanged: textDiffDetected,
    ocrLayerChanged,
    visualLayerChanged
  };

  const mergedChangedPages = mergeChangedPages(
    streamDiff.changedPages,
    ocrDiffSummary.changedPages,
    visualChangedPages
  );
  const nonTextualVariationDetected =
    !canonicalHashMatch &&
    pageCountMatch &&
    !detectors.textLayerChanged &&
    !detectors.ocrLayerChanged &&
    !detectors.visualLayerChanged;

  const signatureVerification = buildSignatureVerification(document, snapshot);

  let resultStatus = "verified";
  let resultReasonCode = "VERIFIED";
  let resultMessage = "Document is verified";

  if (!qrCheck.valid) {
    resultStatus = "suspicious";
    resultReasonCode = qrCheck.reasonCode;
    resultMessage = qrCheck.reason;
  } else if (lifecycleStatus) {
    resultStatus = lifecycleStatus.status;
    resultReasonCode = lifecycleStatus.reasonCode;
    resultMessage = lifecycleStatus.reason;
  } else if (signatureVerification.signatureValid === false) {
    resultStatus = "suspicious";
    resultReasonCode = "SIGNATURE_MISMATCH";
    resultMessage = "Stored signature could not be validated with issuer public key";
  } else if (!pageCountMatch) {
    resultStatus = "tampered";
    resultReasonCode = "PAGE_COUNT_MISMATCH";
    resultMessage = "Uploaded PDF page count does not match the issued document";
  } else if (
    issuedBinaryHashMatch === false &&
    !detectors.textLayerChanged &&
    !detectors.ocrLayerChanged &&
    !detectors.visualLayerChanged &&
    !visualBaselineAvailable
  ) {
    resultStatus = "suspicious";
    resultReasonCode = "BINARY_HASH_MISMATCH_WITHOUT_VISUAL_BASELINE";
    resultMessage = "Uploaded PDF differs from the issued binary, but visual baseline is unavailable";
  } else if (detectors.textLayerChanged) {
    resultStatus = "tampered";
    resultReasonCode = "TEXT_DIFF_DETECTED";
    resultMessage = "Text differences were detected in the uploaded PDF";
  } else if (detectors.ocrLayerChanged) {
    resultStatus = "tampered";
    resultReasonCode = "OCR_DIFF_DETECTED";
    resultMessage = "OCR differences were detected in the uploaded PDF";
  } else if (detectors.visualLayerChanged) {
    resultStatus = "tampered";
    resultReasonCode = "VISUAL_DIFF_DETECTED";
    resultMessage = "Visual differences were detected in the uploaded PDF";
  } else if (!canonicalHashMatch) {
    if (nonTextualVariationDetected) {
      resultStatus = "verified";
      resultReasonCode = "VERIFIED_NON_TEXTUAL_VARIATION";
      resultMessage = "Document text matches the issued record; non-textual PDF variation detected";
    } else {
      resultStatus = "tampered";
      resultReasonCode = "CONTENT_HASH_MISMATCH";
      resultMessage = "Uploaded PDF content hash does not match the issued document";
    }
  } else if (!metadataHashMatch) {
    resultStatus = "tampered";
    resultReasonCode = "METADATA_HASH_MISMATCH";
    resultMessage = "Uploaded PDF metadata hash does not match the issued document";
  }

  const changedWords = [...streamDiff.changedOriginal, ...streamDiff.changedCandidate];
  const textRectanglesByPage = mapChangedWordsToRectangles(changedWords);
  const rectanglesByPage = mergeRectanglesByPage(textRectanglesByPage, visualRectanglesByPage);
  const tamperFindings = {
    changedWordCount: changedWords.length,
    changedPages: mergedChangedPages,
    rectanglesByPage,
    detectors,
    visualDiffScoreByPage,
    visualRectanglesByPage,
    ocrDiffSummary,
    visualChangedPages,
    summary: [
      ...(!pageCountMatch ? ["Page count mismatch"] : []),
      ...(detectors.textLayerChanged ? ["Text token differences detected"] : []),
      ...(detectors.ocrLayerChanged ? ["OCR layer differences detected"] : []),
      ...(detectors.visualLayerChanged ? ["Visual layer differences exceeded threshold"] : []),
      ...(!canonicalHashMatch ? ["Canonical content hash mismatch"] : []),
      ...(!metadataHashMatch ? ["Metadata hash mismatch"] : []),
      ...(issuedBinaryHashMatch === false ? ["Uploaded binary hash differs from issued baseline hash"] : []),
      ...(signatureVerification.signatureValid === false ? ["Signature validation failed"] : []),
      ...(!visualBaselineAvailable && env.VISUAL_DIFF_ENABLED ? ["Visual baseline unavailable in runtime"] : []),
      ...(visualDetectorError ? [`Visual detector fallback: ${visualDetectorError}`] : [])
    ]
  };

  const completedAt = new Date();
  const attempt = await createVerificationAttempt({
    attemptId: uuidv4(),
    tenantId: snapshot.tenantId,
    documentId: snapshot.documentId,
    issuerUserId: snapshot.issuerUserId,
    verifierUserId,
    method: "upload",
    requestIpHash: hashIp(req.ip),
    userAgent: req.headers["user-agent"] || null,
    requestFileName: file.originalname || null,
    requestFileSizeBytes: file.size,
    requestReceivedAt: receivedAt,
    completedAt,
    latencyMs: completedAt.getTime() - receivedAt.getTime(),
    resultStatus,
    resultReasonCode,
    resultMessage,
    qrPayloadReceived: qrPayload,
    anonymousSessionId,
    publicResultTokenHash,
    uploadedFileHash,
    uploadedMetadataHash: candidateHashes.metadataHash,
    signatureVerification,
    contentComparison: {
      canonicalHashMatch,
      metadataHashMatch,
      pageCountMatch,
      issuedBinaryHashMatch,
      visualBaselineAvailable,
      detectors
    },
    tamperFindings
  });

  await Promise.all([
    appendAuditEntry({
      tenantId: snapshot.tenantId,
      action: "DOCUMENT_VERIFIED_UPLOAD",
      documentId: snapshot.documentId,
      actorId: verifierUserId || "anonymous",
      actorType: verifierUserId ? "verifier_user" : "anonymous",
      payload: {
        attemptId: attempt.attemptId,
        resultStatus,
        resultReasonCode,
        changedWordCount: tamperFindings.changedWordCount,
        changedPages: tamperFindings.changedPages,
        detectors
      }
    }),
    Document.updateOne(
      { documentId: snapshot.documentId },
      {
        $set: {
          latestVerificationStatus: resultStatus,
          latestVerifiedAt: completedAt
        }
      }
    )
  ]);

  if (snapshot.issuerUserId) {
    await recomputeTrustScore({
      issuerUserId: snapshot.issuerUserId,
      triggerType: "verification",
      triggerRef: attempt.attemptId
    });
  }

  const trustSummary = snapshot.issuerUserId ? await getTrustScore(snapshot.issuerUserId) : null;

  return {
    attempt: sanitizeAttemptForResponse(attempt),
    result: {
      status: resultStatus,
      reasonCode: resultReasonCode,
      reason: resultMessage,
      documentId: snapshot.documentId,
      issuerInstitutionName: snapshot.issuerInstitutionName,
      trustScore: trustSummary,
      detectors,
      visualDiffScoreByPage,
      ocrDiffSummary,
      tamperFindings: resultStatus === "tampered" || resultStatus === "suspicious" ? tamperFindings : null
    },
    ...(resultAccessToken ? { resultAccessToken } : {})
  };
}

async function verifyUploadedFile(req) {
  const baseContext = resolveUploadRequestContext(req);
  const isAnonymous = !baseContext.verifierUserId;
  const resultAccessToken = isAnonymous ? createResultAccessToken() : null;
  const context = {
    ...baseContext,
    resultAccessToken,
    publicResultTokenHash: hashResultToken(resultAccessToken),
    anonymousSessionId: isAnonymous ? buildAnonymousSessionId(req.ip, req.headers["user-agent"] || null) : null
  };
  const { body, documentId, uploadedFileHash, file, publicResultTokenHash } = context;
  const jobId = buildVerificationJobId({ documentId, uploadedFileHash });
  const existingJob = await getVerifyJob(jobId);

  if (existingJob?.status === "pending") {
    return {
      ...buildPendingJobResponse({ jobId, documentId }),
      ...(existingJob.resultAccessToken ? { resultAccessToken: existingJob.resultAccessToken } : {})
    };
  }

  if (existingJob?.status === "completed" && existingJob.result) {
    return {
      ...existingJob.result,
      ...(existingJob.resultAccessToken ? { resultAccessToken: existingJob.resultAccessToken } : {})
    };
  }

  const prefersAsync =
    String(body?.async || req.query?.async || "").toLowerCase() === "true" ||
    String(req.headers?.prefer || "").toLowerCase().includes("respond-async");
  const detectorEnabled = env.OCR_ENABLED || env.VISUAL_DIFF_ENABLED;
  const shouldRunAsync =
    prefersAsync ||
    Number(file.size) > ASYNC_UPLOAD_SIZE_THRESHOLD_BYTES ||
    (detectorEnabled && Number(file.size) > DETECTOR_ASYNC_SIZE_THRESHOLD_BYTES);

  if (shouldRunAsync) {
    await scheduleVerificationJob({
      jobId,
      documentId,
      executionPromise: {
        req,
        context
      },
      metadata: {
        tenantId: context.auth?.tenantId || null,
        issuerUserId: null,
        verifierUserId: context.verifierUserId,
        resultAccessToken,
        resultAccessTokenHash: publicResultTokenHash
      }
    });
    return {
      ...buildPendingJobResponse({ jobId, documentId }),
      ...(resultAccessToken ? { resultAccessToken } : {})
    };
  }

  const result = await performUploadVerification(req, context);
  await setVerifyJob(jobId, {
    jobId,
    documentId,
    status: "completed",
    completedAt: new Date().toISOString(),
    tenantId: context.auth?.tenantId || null,
    verifierUserId: context.verifierUserId,
    resultAccessToken,
    resultAccessTokenHash: publicResultTokenHash,
    result
  });
  return result;
}

async function getVerificationJob(jobId, { auth = null, resultToken = null } = {}) {
  const cached = await getVerifyJob(jobId);

  if (!cached) {
    throw new AppError("Verification job not found", 404);
  }

  if (
    !canAccessProtectedResult({
      auth,
      tenantId: cached.tenantId,
      verifierUserId: cached.verifierUserId,
      resultToken,
      resultAccessTokenHash: cached.resultAccessTokenHash
    })
  ) {
    throw new AppError("Forbidden", 403);
  }

  return sanitizeJobForResponse(cached);
}

async function getVerificationAttempt(attemptId, { auth = null, resultToken = null } = {}) {
  const attempt = await VerificationAttempt.findOne({ attemptId }).lean();

  if (!attempt) {
    throw new AppError("Verification attempt not found", 404);
  }

  if (
    !canAccessProtectedResult({
      auth,
      tenantId: attempt.tenantId,
      verifierUserId: attempt.verifierUserId,
      resultToken,
      resultAccessTokenHash: attempt.publicResultTokenHash
    })
  ) {
    throw new AppError("Forbidden", 403);
  }

  return sanitizeAttemptForResponse(attempt);
}

module.exports = {
  verifyQrPayload,
  verifyUploadedFile,
  processQueuedVerificationJob,
  getVerificationJob,
  getVerificationAttempt
};
