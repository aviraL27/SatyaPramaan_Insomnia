const { Schema, model } = require("mongoose");

const WordPositionSchema = new Schema(
  {
    text: { type: String, required: true },
    normalizedText: { type: String, required: true },
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    fontName: { type: String },
    fontSize: { type: Number },
    transform: [{ type: Number }],
    readingOrderIndex: { type: Number, required: true }
  },
  { _id: false }
);

const PageTextPositionSchema = new Schema(
  {
    pageNumber: { type: Number, required: true },
    words: { type: [WordPositionSchema], default: [] }
  },
  { _id: false }
);

const DocumentSchema = new Schema(
  {
    documentId: { type: String, required: true, unique: true, index: true },
    tenantId: { type: String, required: true, index: true },
    issuerUserId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    issuerInstitutionName: { type: String, required: true },
    recipientName: { type: String, required: true },
    recipientReference: { type: String, index: true },
    documentType: { type: String, required: true },
    title: { type: String, required: true },
    versionNumber: { type: Number, required: true, default: 1 },
    parentDocumentId: { type: String, default: null },
    replacementDocumentId: { type: String, default: null },
    status: {
      type: String,
      enum: ["issued", "revoked", "superseded", "expired"],
      default: "issued",
      index: true
    },
    revocationReason: { type: String, default: null },
    issuedAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    sourcePdfStorage: {
      path: String,
      storageType: String
    },
    issuedPdfStorage: {
      path: String,
      storageType: String
    },
    fileName: { type: String, required: true },
    fileSizeBytes: { type: Number, required: true },
    issuedFileSizeBytes: { type: Number, default: null },
    mimeType: { type: String, required: true },
    pageCount: { type: Number, required: true },
    customMetadata: { type: Schema.Types.Mixed, default: {} },
    pdfMetadata: { type: Schema.Types.Mixed, default: {} },
    canonicalContentHash: { type: String, required: true },
    fileBinaryHash: { type: String, required: true },
    metadataHash: { type: String, required: true },
    signatureAlgorithm: { type: String, required: true, default: "RSA-SHA256" },
    signatureId: { type: String, required: true },
    signatureValue: { type: String, required: true },
    signingKeyFingerprint: { type: String, required: true },
    verificationToken: { type: String, required: true, unique: true, index: true },
    verificationTokenExpiresAt: { type: Date, default: null },
    qrPayload: { type: Schema.Types.Mixed, required: true },
    extractedTextVersion: { type: Number, required: true, default: 1 },
    textPositions: { type: [PageTextPositionSchema], default: [] },
    ocrBaseline: { type: Schema.Types.Mixed, default: null },
    issuanceIdempotencyKey: { type: String, default: undefined },
    issuanceRequestHash: { type: String, default: undefined },
    latestVerificationStatus: { type: String, default: null },
    latestVerifiedAt: { type: Date, default: null }
  },
  {
    timestamps: true
  }
);

DocumentSchema.index({ tenantId: 1, issuerUserId: 1, issuedAt: -1 });
DocumentSchema.index({ status: 1, revokedAt: -1 });
DocumentSchema.index(
  { tenantId: 1, issuerUserId: 1, issuanceIdempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      issuanceIdempotencyKey: {
        $exists: true,
        $type: "string"
      }
    }
  }
);

module.exports = model("Document", DocumentSchema);
