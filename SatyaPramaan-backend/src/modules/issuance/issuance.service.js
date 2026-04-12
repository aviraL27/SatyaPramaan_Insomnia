const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const QRCode = require("qrcode");
const { v4: uuidv4 } = require("uuid");
const Document = require("../../models/Document.model");
const User = require("../../models/User.model");
const { decryptPrivateKey } = require("../../crypto/privateKeyVault");
const { signPayload } = require("../../crypto/documentSigner");
const { buildQrPayload } = require("../../crypto/qrPayloadBuilder");
const { setDocumentSnapshot } = require("../../cache/documentSnapshotCache");
const { setPdfPositions } = require("../../cache/pdfPositionCache");
const { appendAuditEntry } = require("../audit-ledger/auditLedger.service");
const { recomputeTrustScore } = require("../trust-score/trustScore.service");
const { parsePdfWithPositions } = require("../../pdf-pipeline/pdfParser");
const { canonicalize } = require("../../pdf-pipeline/pdfCanonicalizer");
const { buildCanonicalContentHash, sha256 } = require("../../pdf-pipeline/pdfHasher");
const { injectQrIntoPdf } = require("../../pdf-pipeline/pdfQRInjector");
const { getIdempotencyKey, hashRequestBody } = require("../../utils/idempotency");
const { AppError } = require("../../utils/AppError");
const { extractOcrLayer } = require("../verification/ocr.service");

function sanitizeFileName(fileName = "document.pdf") {
  return path.basename(fileName).replace(/[^\w.\-() ]+/g, "_");
}

function createDocumentId() {
  return `doc_${uuidv4()}`;
}

function createSignatureId() {
  return `sig_${uuidv4()}`;
}

function createVerificationToken() {
  return crypto.randomBytes(24).toString("hex");
}

function normalizeIssuanceBody(body = {}) {
  return {
    title: body.title,
    documentType: body.documentType,
    recipientName: body.recipientName,
    recipientReference: body.recipientReference || null,
    expiresAt: body.expiresAt ? new Date(body.expiresAt).toISOString() : null,
    metadata: body.metadata || {}
  };
}

function buildIssuanceHashes({ body, parsedPdf }) {
  const normalizedBody = normalizeIssuanceBody(body);
  const metadataDescriptor = {
    document: {
      title: normalizedBody.title,
      documentType: normalizedBody.documentType,
      recipientName: normalizedBody.recipientName,
      recipientReference: normalizedBody.recipientReference,
      expiresAt: normalizedBody.expiresAt
    },
    customMetadata: normalizedBody.metadata,
    pdf: {
      pageCount: parsedPdf.pageCount,
      metadata: parsedPdf.metadata
    }
  };
  const contentDescriptor = {
    metadata: metadataDescriptor,
    extractedTextVersion: 1,
    fullText: parsedPdf.fullText,
    pages: parsedPdf.pageText
  };

  return {
    metadataDescriptor,
    contentDescriptor,
    metadataHash: buildCanonicalContentHash(metadataDescriptor),
    canonicalContentHash: buildCanonicalContentHash(contentDescriptor)
  };
}

function buildIssuanceRequestHash({ body, fileBinaryHash }) {
  return sha256(`${hashRequestBody(normalizeIssuanceBody(body))}:${fileBinaryHash}`);
}

function buildSignaturePayload({
  documentId,
  tenantId,
  issuerUserId,
  issuedAt,
  signatureId,
  verificationToken,
  metadataHash,
  canonicalContentHash,
  fileBinaryHash,
  signingKeyFingerprint
}) {
  return {
    documentId,
    tenantId,
    issuerUserId,
    issuedAt,
    signatureId,
    verificationToken,
    metadataHash,
    canonicalContentHash,
    fileBinaryHash,
    signingKeyFingerprint
  };
}

function toPlainObject(value) {
  return typeof value?.toObject === "function" ? value.toObject() : { ...value };
}

function buildIssuedDocumentResponse(document, { idempotencyKey = null, replayed = false } = {}) {
  const plainDocument = toPlainObject(document);

  return {
    document: {
      documentId: plainDocument.documentId,
      tenantId: plainDocument.tenantId,
      issuerUserId: String(plainDocument.issuerUserId),
      issuerInstitutionName: plainDocument.issuerInstitutionName,
      title: plainDocument.title,
      documentType: plainDocument.documentType,
      recipientName: plainDocument.recipientName,
      recipientReference: plainDocument.recipientReference,
      status: plainDocument.status,
      issuedAt: plainDocument.issuedAt,
      expiresAt: plainDocument.expiresAt,
      verificationToken: plainDocument.verificationToken,
      qrPayload: plainDocument.qrPayload,
      signature: {
        signatureId: plainDocument.signatureId,
        signatureAlgorithm: plainDocument.signatureAlgorithm,
        signingKeyFingerprint: plainDocument.signingKeyFingerprint
      },
      sourcePdfStorage: plainDocument.sourcePdfStorage,
      issuedPdfStorage: plainDocument.issuedPdfStorage
    },
    file: {
      fileName: plainDocument.fileName,
      mimeType: plainDocument.mimeType,
      originalSizeBytes: plainDocument.fileSizeBytes,
      issuedSizeBytes: plainDocument.issuedFileSizeBytes,
      pageCount: plainDocument.pageCount,
      hashes: {
        metadataHash: plainDocument.metadataHash,
        canonicalContentHash: plainDocument.canonicalContentHash,
        fileBinaryHash: plainDocument.fileBinaryHash
      }
    },
    idempotency: idempotencyKey
      ? {
          key: idempotencyKey,
          replayed
        }
      : null
  };
}

function buildSnapshotPayload(document, issuer) {
  const plainDocument = toPlainObject(document);

  return {
    documentId: plainDocument.documentId,
    tenantId: plainDocument.tenantId,
    status: plainDocument.status,
    canonicalContentHash: plainDocument.canonicalContentHash,
    verificationToken: plainDocument.verificationToken,
    issuerUserId: String(plainDocument.issuerUserId),
    issuerInstitutionName: plainDocument.issuerInstitutionName,
    qrPayload: plainDocument.qrPayload,
    signingKeyFingerprint: plainDocument.signingKeyFingerprint,
    issuerPublicKeyPem: issuer.rsaPublicKeyPem || null
  };
}

async function persistPdfArtifacts({ tenantId, documentId, sourcePdfBuffer, issuedPdfBuffer }) {
  const documentDir = path.join(process.cwd(), "storage", "documents", tenantId, documentId);
  const sourceAbsolutePath = path.join(documentDir, "source.pdf");
  const issuedAbsolutePath = path.join(documentDir, "issued.pdf");

  await fs.mkdir(documentDir, { recursive: true });
  await fs.writeFile(sourceAbsolutePath, sourcePdfBuffer);
  await fs.writeFile(issuedAbsolutePath, issuedPdfBuffer);

  return {
    sourcePdfStorage: {
      path: path.relative(process.cwd(), sourceAbsolutePath).split(path.sep).join("/"),
      storageType: "local_fs"
    },
    issuedPdfStorage: {
      path: path.relative(process.cwd(), issuedAbsolutePath).split(path.sep).join("/"),
      storageType: "local_fs"
    }
  };
}

async function loadExistingIdempotentDocument({ tenantId, issuerUserId, idempotencyKey, requestHash }) {
  if (!idempotencyKey) {
    return null;
  }

  const existing = await Document.findOne({
    tenantId,
    issuerUserId,
    issuanceIdempotencyKey: idempotencyKey
  });

  if (!existing) {
    return null;
  }

  if (existing.issuanceRequestHash !== requestHash) {
    throw new AppError("Idempotency key was already used with a different issuance payload", 409);
  }

  return existing;
}

function assertIssuancePrerequisites({ tenantId, file, issuer }) {
  if (!tenantId) {
    throw new AppError("Tenant context is required for document issuance", 400);
  }

  if (!file?.buffer || !file.size) {
    throw new AppError("PDF file is required", 400);
  }

  if (file.mimetype !== "application/pdf") {
    throw new AppError("Only PDF uploads are allowed", 400);
  }

  if (!issuer) {
    throw new AppError("Issuer account not found", 404);
  }

  if (!issuer.encryptedPrivateKey || !issuer.rsaPublicKeyFingerprint || !issuer.rsaPublicKeyPem) {
    throw new AppError("Issuer keys are not configured", 409);
  }
}

async function issueDocument(req) {
  const file = req.file;
  const body = req.validated?.body || req.body || {};
  const tenantId = req.auth?.tenantId;
  const issuerUserId = req.auth?.userId;
  const fileBinaryHash = sha256(file?.buffer || "");
  const idempotencyKey = getIdempotencyKey(req);
  const issuanceRequestHash = buildIssuanceRequestHash({ body, fileBinaryHash });
  const issuanceIdempotencyFields = idempotencyKey
    ? {
        issuanceIdempotencyKey: idempotencyKey,
        issuanceRequestHash
      }
    : {};

  const existing = await loadExistingIdempotentDocument({
    tenantId,
    issuerUserId,
    idempotencyKey,
    requestHash: issuanceRequestHash
  });

  if (existing) {
    return buildIssuedDocumentResponse(existing, { idempotencyKey, replayed: true });
  }

  const issuer = await User.findOne({ _id: issuerUserId, tenantId });
  assertIssuancePrerequisites({ tenantId, file, issuer });
  const normalizedBody = normalizeIssuanceBody(body);

  const parsedPdf = await parsePdfWithPositions(file.buffer);
  const { metadataHash, canonicalContentHash } = buildIssuanceHashes({ body, parsedPdf });
  const documentId = createDocumentId();
  const signatureId = createSignatureId();
  const verificationToken = createVerificationToken();
  const issuedAtIso = new Date().toISOString();
  const privateKeyPem = decryptPrivateKey(issuer.encryptedPrivateKey);
  const signaturePayload = buildSignaturePayload({
    documentId,
    tenantId,
    issuerUserId: String(issuer._id),
    issuedAt: issuedAtIso,
    signatureId,
    verificationToken,
    metadataHash,
    canonicalContentHash,
    fileBinaryHash,
    signingKeyFingerprint: issuer.rsaPublicKeyFingerprint
  });
  const signatureValue = signPayload(canonicalize(signaturePayload), privateKeyPem);
  const qrPayload = buildQrPayload({
    documentId,
    tenantId,
    signatureId,
    contentHash: canonicalContentHash,
    verificationToken,
    issuedAt: issuedAtIso,
    privateKeyPem
  });
  const qrDataUrl = await QRCode.toDataURL(JSON.stringify(qrPayload), {
    errorCorrectionLevel: "L",
    margin: 4,
    width: 420,
    color: {
      dark: "#000000",
      light: "#FFFFFFFF"
    }
  });
  const issuedPdfBuffer = await injectQrIntoPdf(file.buffer, qrDataUrl, body.qrPlacement || {});
  const issuedFileHash = sha256(issuedPdfBuffer);
  let issuedParsedPdf = parsedPdf;

  try {
    issuedParsedPdf = await parsePdfWithPositions(issuedPdfBuffer);
  } catch (_error) {
    issuedParsedPdf = parsedPdf;
  }

  const ocrBaseline = await extractOcrLayer({
    documentId,
    fileHash: issuedFileHash,
    pdfBuffer: issuedPdfBuffer,
    parsedPdf: issuedParsedPdf,
    useCache: true
  });
  const storage = await persistPdfArtifacts({
    tenantId,
    documentId,
    sourcePdfBuffer: file.buffer,
    issuedPdfBuffer
  });

  let createdDocument;

  try {
    createdDocument = await Document.create({
      documentId,
      tenantId,
      issuerUserId,
      issuerInstitutionName: issuer.institutionName || issuer.displayName,
      recipientName: body.recipientName,
      recipientReference: body.recipientReference || null,
      documentType: body.documentType,
      title: body.title,
      issuedAt: new Date(issuedAtIso),
      expiresAt: body.expiresAt || null,
      sourcePdfStorage: storage.sourcePdfStorage,
      issuedPdfStorage: storage.issuedPdfStorage,
      fileName: sanitizeFileName(file.originalname),
      fileSizeBytes: file.size,
      issuedFileSizeBytes: issuedPdfBuffer.length,
      mimeType: file.mimetype,
      pageCount: parsedPdf.pageCount,
      customMetadata: normalizedBody.metadata,
      pdfMetadata: parsedPdf.metadata,
      canonicalContentHash,
      fileBinaryHash,
      metadataHash,
      signatureAlgorithm: "RSA-SHA256",
      signatureId,
      signatureValue,
      signingKeyFingerprint: issuer.rsaPublicKeyFingerprint,
      verificationToken,
      qrPayload,
      extractedTextVersion: 1,
      textPositions: parsedPdf.textPositions,
      ocrBaseline: {
        ...ocrBaseline,
        fileHash: issuedFileHash,
        source: "issued_pdf"
      },
      ...issuanceIdempotencyFields
    });
  } catch (error) {
    if (error?.code === 11000 && idempotencyKey) {
      const conflicted = await loadExistingIdempotentDocument({
        tenantId,
        issuerUserId,
        idempotencyKey,
        requestHash: issuanceRequestHash
      });

      if (conflicted) {
        return buildIssuedDocumentResponse(conflicted, { idempotencyKey, replayed: true });
      }
    }

    throw error;
  }

  await Promise.all([
    appendAuditEntry({
      tenantId,
      action: "DOCUMENT_ISSUED",
      documentId,
      actorId: issuerUserId,
      actorType: "institution_user",
      payload: {
        documentId,
        signatureId,
        verificationToken,
        qrPayload,
        qrPayloadHash: sha256(canonicalize(qrPayload)),
        metadataHash,
        canonicalContentHash,
        fileBinaryHash,
        pageCount: parsedPdf.pageCount
      }
    }),
    setDocumentSnapshot(documentId, buildSnapshotPayload(createdDocument, issuer)),
    setPdfPositions(documentId, fileBinaryHash, {
      extractedTextVersion: 1,
      pageCount: parsedPdf.pageCount,
      textPositions: parsedPdf.textPositions
    }),
    recomputeTrustScore({
      issuerUserId,
      triggerType: "issuance",
      triggerRef: documentId
    })
  ]);

  return buildIssuedDocumentResponse(createdDocument, { idempotencyKey, replayed: false });
}

module.exports = {
  issueDocument,
  buildIssuanceHashes,
  buildIssuanceRequestHash,
  buildSignaturePayload,
  buildIssuedDocumentResponse
};
