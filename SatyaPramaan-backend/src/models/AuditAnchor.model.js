const { Schema, model } = require("mongoose");

const AuditAnchorSchema = new Schema(
  {
    anchorId: { type: String, required: true, unique: true, index: true },
    tenantId: { type: String, required: true, index: true },
    sequenceNumber: { type: Number, required: true, index: true },
    anchoredHash: { type: String, required: true },
    network: { type: String, required: true },
    chainId: { type: String, required: true },
    recipientAddress: { type: String, required: true },
    transactionHash: { type: String, required: true, unique: true, index: true },
    blockNumber: { type: Number, required: true, index: true },
    actorId: { type: String, required: true },
    payloadHex: { type: String, required: true },
    explorerUrl: { type: String, default: null }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

AuditAnchorSchema.index({ tenantId: 1, createdAt: -1 });

module.exports = model("AuditAnchor", AuditAnchorSchema);
