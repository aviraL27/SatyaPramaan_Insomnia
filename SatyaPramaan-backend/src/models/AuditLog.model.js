const { Schema, model } = require("mongoose");

const AuditLogSchema = new Schema(
  {
    entryId: { type: String, required: true, unique: true, index: true },
    sequenceNumber: { type: Number, required: true, unique: true, index: true },
    tenantId: { type: String, required: true, index: true },
    action: { type: String, required: true, index: true },
    documentId: { type: String, default: null, index: true },
    actorId: { type: String, required: true, index: true },
    actorType: {
      type: String,
      enum: ["institution_user", "verifier_user", "anonymous", "system", "platform_admin"],
      required: true
    },
    timestamp: { type: Date, required: true, index: true },
    payload: { type: Schema.Types.Mixed, required: true },
    payloadHash: { type: String, required: true },
    previousEntryHash: { type: String, required: true },
    currentEntryHash: { type: String, required: true },
    chainHeadAtWrite: { type: String, required: true },
    integrityStatus: { type: String, enum: ["valid", "suspect", "broken"], default: "valid" },
    verificationRunId: { type: String, default: null }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

AuditLogSchema.index({ tenantId: 1, timestamp: -1 });
AuditLogSchema.index({ documentId: 1, timestamp: -1 });
AuditLogSchema.index({ actorId: 1, timestamp: -1 });

module.exports = model("AuditLog", AuditLogSchema);
