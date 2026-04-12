const { Schema, model } = require("mongoose");

const VerificationAttemptSchema = new Schema(
  {
    attemptId: { type: String, required: true, unique: true, index: true },
    tenantId: { type: String, default: null },
    documentId: { type: String, default: null, index: true },
    issuerUserId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    verifierUserId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    anonymousSessionId: { type: String, default: null, index: true },
    method: { type: String, enum: ["qr", "upload", "api"], required: true },
    requestIpHash: { type: String, required: true },
    userAgent: { type: String, default: null },
    requestFileName: { type: String, default: null },
    requestFileSizeBytes: { type: Number, default: null },
    requestReceivedAt: { type: Date, required: true },
    completedAt: { type: Date, default: null },
    latencyMs: { type: Number, default: null },
    resultStatus: {
      type: String,
      enum: ["verified", "suspicious", "tampered", "revoked", "not_found", "pending", "error"],
      required: true,
      index: true
    },
    resultReasonCode: { type: String, required: true },
    resultMessage: { type: String, required: true },
    qrPayloadReceived: { type: Schema.Types.Mixed, default: null },
    uploadedFileHash: { type: String, default: null },
    uploadedMetadataHash: { type: String, default: null },
    signatureVerification: { type: Schema.Types.Mixed, default: null },
    contentComparison: { type: Schema.Types.Mixed, default: null },
    tamperFindings: { type: Schema.Types.Mixed, default: null },
    trustScoreDelta: { type: Schema.Types.Mixed, default: null },
    asyncJobId: { type: String, default: null },
    publicResultTokenHash: { type: String, default: null, index: true }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

VerificationAttemptSchema.index({ documentId: 1, createdAt: -1 });
VerificationAttemptSchema.index({ issuerUserId: 1, createdAt: -1 });
VerificationAttemptSchema.index({ anonymousSessionId: 1, createdAt: -1 });

module.exports = model("VerificationAttempt", VerificationAttemptSchema);
