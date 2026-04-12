const { Schema, model } = require("mongoose");

const TrustScoreHistorySchema = new Schema(
  {
    eventId: { type: String, required: true },
    triggerType: { type: String, required: true },
    triggerRef: { type: String, default: null },
    previousScore: { type: Number, required: true },
    newScore: { type: Number, required: true },
    delta: { type: Number, required: true },
    formulaInputs: { type: Schema.Types.Mixed, required: true },
    weightsApplied: { type: Schema.Types.Mixed, required: true },
    computedAt: { type: Date, required: true }
  },
  { _id: false }
);

const TrustScoreSchema = new Schema(
  {
    issuerUserId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
    tenantId: { type: String, required: true, index: true },
    currentScore: { type: Number, required: true, default: 0, index: true },
    scoreBand: { type: String, enum: ["high", "medium", "low", "critical", "unrated"], default: "unrated" },
    lastComputedAt: { type: Date, required: true, default: Date.now },
    history: { type: [TrustScoreHistorySchema], default: [] },
    metrics: {
      totalVerifications: { type: Number, default: 0 },
      successfulVerifications: { type: Number, default: 0 },
      tamperedDetections: { type: Number, default: 0 },
      revokedDocuments: { type: Number, default: 0 },
      cleanRecentVerifications: { type: Number, default: 0 },
      anomalyEventsLast24h: { type: Number, default: 0 }
    }
  },
  {
    timestamps: true
  }
);

TrustScoreSchema.index({ tenantId: 1, currentScore: -1 });

module.exports = model("TrustScore", TrustScoreSchema);
