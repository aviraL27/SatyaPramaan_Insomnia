const crypto = require("crypto");
const fs = require("fs");
const fsPromises = require("fs/promises");
const path = require("path");
const QRCode = require("qrcode");
const { v4: uuidv4 } = require("uuid");
const Document = require("../../models/Document.model");
const User = require("../../models/User.model");
const { decryptPrivateKey } = require("../../crypto/privateKeyVault");
const { signPayload } = require("../../crypto/documentSigner");
const { buildQrPayload } = require("../../crypto/qrPayloadBuilder");
const { parsePdfWithPositions } = require("../../pdf-pipeline/pdfParser");
const { injectQrIntoPdf } = require("../../pdf-pipeline/pdfQRInjector");
const { canonicalize } = require("../../pdf-pipeline/pdfCanonicalizer");
const { sha256 } = require("../../pdf-pipeline/pdfHasher");
const { buildIssuanceHashes, buildSignaturePayload, buildIssuedDocumentResponse } = require("../issuance/issuance.service");
const { setPdfPositions } = require("../../cache/pdfPositionCache");
const { invalidateDocumentSnapshot, setDocumentSnapshot } = require("../../cache/documentSnapshotCache");
const { appendAuditEntry } = require("../audit-ledger/auditLedger.service");
const { recomputeTrustScore } = require("../trust-score/trustScore.service");
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

function canAccessDocumentByAuth(auth, documentTenantId) {
  if (!auth) {
    return false;
  }

  if (auth.role === "platform_admin") {
    return true;
  }

  if (
    ["institution_admin", "institution_operator"].includes(auth.role) &&
    auth.tenantId &&
    String(auth.tenantId) === String(documentTenantId)
  ) {
    return true;
  }

  return false;
}

function buildSnapshotPayload(document, issuer) {
  const plainDocument = typeof document.toObject === "function" ? document.toObject() : document;

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
    issuerPublicKeyPem: issuer?.rsaPublicKeyPem || null
  };
}

async function persistPdfArtifacts({ tenantId, documentId, sourcePdfBuffer, issuedPdfBuffer }) {
  const documentDir = path.join(process.cwd(), "storage", "documents", tenantId, documentId);
  const sourceAbsolutePath = path.join(documentDir, "source.pdf");
  const issuedAbsolutePath = path.join(documentDir, "issued.pdf");

  await fsPromises.mkdir(documentDir, { recursive: true });
  await fsPromises.writeFile(sourceAbsolutePath, sourcePdfBuffer);
  await fsPromises.writeFile(issuedAbsolutePath, issuedPdfBuffer);

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

function assertReplacePrerequisites({ tenantId, file, actor }) {
  if (!tenantId) {
    throw new AppError("Tenant context is required", 400);
  }

  if (!file?.buffer || !file.size) {
    throw new AppError("PDF file is required", 400);
  }

  if (file.mimetype !== "application/pdf") {
    throw new AppError("Only PDF uploads are allowed", 400);
  }

  if (!actor) {
    throw new AppError("Issuer account not found", 404);
  }

  if (!actor.encryptedPrivateKey || !actor.rsaPublicKeyFingerprint || !actor.rsaPublicKeyPem) {
    throw new AppError("Issuer keys are not configured", 409);
  }
}

async function listDocuments({ tenantId, issuerUserId }) {
  return Document.find({ tenantId, issuerUserId }).sort({ issuedAt: -1 }).lean();
}

async function getDocumentById({ tenantId, documentId }) {
  const document = await Document.findOne({ tenantId, documentId }).lean();

  if (!document) {
    throw new AppError("Document not found", 404);
  }

  return document;
}

async function revokeDocument({ tenantId, actorId, documentId, reason }) {
  const document = await Document.findOne({ tenantId, documentId });

  if (!document) {
    throw new AppError("Document not found", 404);
  }

  if (document.status !== "issued") {
    throw new AppError("Only issued documents can be revoked", 409);
  }

  document.status = "revoked";
  document.revocationReason = reason;
  document.revokedAt = new Date();
  await document.save();

  await invalidateDocumentSnapshot(documentId);
  await appendAuditEntry({
    tenantId,
    action: "DOCUMENT_REVOKED",
    documentId,
    actorId,
    actorType: "institution_user",
    payload: {
      documentId,
      reason
    }
  });
  await recomputeTrustScore({
    issuerUserId: document.issuerUserId,
    triggerType: "revocation",
    triggerRef: documentId
  });

  return document.toObject();
}

async function listDocumentVersions({ tenantId, documentId }) {
  const root = await Document.findOne({
    tenantId,
    $or: [{ documentId }, { parentDocumentId: documentId }, { replacementDocumentId: documentId }]
  }).lean();

  if (!root) {
    throw new AppError("Document not found", 404);
  }

  return Document.find({
    tenantId,
    $or: [
      { documentId: root.documentId },
      { parentDocumentId: root.documentId },
      { replacementDocumentId: root.documentId }
    ]
  }).sort({ versionNumber: 1 }).lean();
}

async function getDocumentDownloadInfo({ auth = null, documentId, token = null }) {
  const document = await Document.findOne({ documentId }).lean();

  if (!document) {
    throw new AppError("Document not found", 404);
  }

  const canAccessByAuth = canAccessDocumentByAuth(auth, document.tenantId);
  const canAccessByToken = token && token === document.verificationToken;

  if (!canAccessByAuth && !canAccessByToken) {
    throw new AppError("Forbidden", 403);
  }

  if (!document.issuedPdfStorage?.path) {
    throw new AppError("Issued PDF path not found", 404);
  }

  const absolutePath = path.resolve(process.cwd(), document.issuedPdfStorage.path);

  if (!fs.existsSync(absolutePath)) {
    throw new AppError("Issued PDF file does not exist", 404);
  }

  return {
    filePath: absolutePath,
    fileName: sanitizeFileName(`${document.documentId}-issued.pdf`),
    document
  };
}

async function replaceDocument({ tenantId, actorId, documentId, body, file }) {
  const parent = await Document.findOne({ tenantId, documentId });

  if (!parent) {
    throw new AppError("Document not found", 404);
  }

  if (parent.status !== "issued") {
    throw new AppError("Only issued documents can be replaced", 409);
  }

  const actor = await User.findOne({ _id: actorId, tenantId });
  assertReplacePrerequisites({ tenantId, file, actor });

  const parsedPdf = await parsePdfWithPositions(file.buffer);
  const { metadataHash, canonicalContentHash } = buildIssuanceHashes({ body, parsedPdf });
  const fileBinaryHash = sha256(file.buffer);
  const replacementDocumentId = createDocumentId();
  const signatureId = createSignatureId();
  const verificationToken = createVerificationToken();
  const issuedAtIso = new Date().toISOString();
  const privateKeyPem = decryptPrivateKey(actor.encryptedPrivateKey);
  const signaturePayload = buildSignaturePayload({
    documentId: replacementDocumentId,
    tenantId,
    issuerUserId: String(actor._id),
    issuedAt: issuedAtIso,
    signatureId,
    verificationToken,
    metadataHash,
    canonicalContentHash,
    fileBinaryHash,
    signingKeyFingerprint: actor.rsaPublicKeyFingerprint
  });
  const signatureValue = signPayload(canonicalize(signaturePayload), privateKeyPem);
  const qrPayload = buildQrPayload({
    documentId: replacementDocumentId,
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
    documentId: replacementDocumentId,
    fileHash: issuedFileHash,
    pdfBuffer: issuedPdfBuffer,
    parsedPdf: issuedParsedPdf,
    useCache: true
  });
  const storage = await persistPdfArtifacts({
    tenantId,
    documentId: replacementDocumentId,
    sourcePdfBuffer: file.buffer,
    issuedPdfBuffer
  });

  const replacement = await Document.create({
    documentId: replacementDocumentId,
    tenantId,
    issuerUserId: actorId,
    issuerInstitutionName: actor.institutionName || actor.displayName,
    recipientName: body.recipientName,
    recipientReference: body.recipientReference || null,
    documentType: body.documentType,
    title: body.title,
    versionNumber: Number(parent.versionNumber || 1) + 1,
    parentDocumentId: parent.documentId,
    issuedAt: new Date(issuedAtIso),
    expiresAt: body.expiresAt || null,
    sourcePdfStorage: storage.sourcePdfStorage,
    issuedPdfStorage: storage.issuedPdfStorage,
    fileName: sanitizeFileName(file.originalname),
    fileSizeBytes: file.size,
    issuedFileSizeBytes: issuedPdfBuffer.length,
    mimeType: file.mimetype,
    pageCount: parsedPdf.pageCount,
    customMetadata: body.metadata || {},
    pdfMetadata: parsedPdf.metadata,
    canonicalContentHash,
    fileBinaryHash,
    metadataHash,
    signatureAlgorithm: "RSA-SHA256",
    signatureId,
    signatureValue,
    signingKeyFingerprint: actor.rsaPublicKeyFingerprint,
    verificationToken,
    qrPayload,
    extractedTextVersion: 1,
    textPositions: parsedPdf.textPositions,
    ocrBaseline: {
      ...ocrBaseline,
      fileHash: issuedFileHash,
      source: "issued_pdf"
    }
  });

  parent.status = "superseded";
  parent.replacementDocumentId = replacementDocumentId;
  parent.revokedAt = new Date();
  parent.revocationReason = "Replaced by a newer version";
  await parent.save();

  await Promise.all([
    invalidateDocumentSnapshot(parent.documentId),
    setDocumentSnapshot(replacementDocumentId, buildSnapshotPayload(replacement, actor)),
    setPdfPositions(replacementDocumentId, fileBinaryHash, {
      extractedTextVersion: 1,
      pageCount: parsedPdf.pageCount,
      textPositions: parsedPdf.textPositions
    }),
    appendAuditEntry({
      tenantId,
      action: "DOCUMENT_REPLACED",
      documentId: replacementDocumentId,
      actorId,
      actorType: "institution_user",
      payload: {
        replacedDocumentId: parent.documentId,
        replacementDocumentId,
        qrPayload,
        previousVersion: parent.versionNumber,
        newVersion: replacement.versionNumber
      }
    }),
    recomputeTrustScore({
      issuerUserId: actorId,
      triggerType: "issuance",
      triggerRef: replacementDocumentId
    })
  ]);

  return buildIssuedDocumentResponse(replacement, {
    idempotencyKey: null,
    replayed: false
  });
}

module.exports = {
  listDocuments,
  getDocumentById,
  revokeDocument,
  listDocumentVersions,
  getDocumentDownloadInfo,
  replaceDocument
};
