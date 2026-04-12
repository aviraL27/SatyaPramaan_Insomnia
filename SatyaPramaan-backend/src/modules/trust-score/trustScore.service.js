const { v4: uuidv4 } = require("uuid");
const TrustScore = require("../../models/TrustScore.model");
const VerificationAttempt = require("../../models/VerificationAttempt.model");
const Document = require("../../models/Document.model");
const User = require("../../models/User.model");
const { invalidateTrustScore, setTrustScore } = require("../../cache/trustCache");

function clamp(min, max, value) {
  return Math.max(min, Math.min(max, value));
}

function getScoreBand(score) {
  if (score >= 80) return "high";
  if (score >= 60) return "medium";
  if (score >= 40) return "low";
  return "critical";
}

function computeScore({ issuerAgeDays, totalVerifications, successfulVerifications, cleanRecentVerifications, tamperedDetections, revokedDocuments, suspiciousAttemptsLast24h, totalAttemptsLast24h, totalIssuedDocuments }) {
  const issuerAgeWeight = Math.min(10, (issuerAgeDays / 365) * 10);
  const successRateWeight = Math.min(20, (successfulVerifications / Math.max(totalVerifications, 1)) * 20);
  const volumeConfidenceWeight = Math.min(10, Math.log10(totalVerifications + 1) * 5);
  const cleanRecentWeight = Math.min(10, (cleanRecentVerifications / 50) * 10);
  const tamperPenalty = Math.min(25, (tamperedDetections / Math.max(totalVerifications, 1)) * 25);
  const revokedPenalty = Math.min(10, (revokedDocuments / Math.max(totalIssuedDocuments, 1)) * 10);
  const anomalyPenalty = Math.min(15, (suspiciousAttemptsLast24h / Math.max(totalAttemptsLast24h, 1)) * 15);

  const score = clamp(
    0,
    100,
    50 + issuerAgeWeight + successRateWeight + volumeConfidenceWeight + cleanRecentWeight - tamperPenalty - revokedPenalty - anomalyPenalty
  );

  return {
    score: Number(score.toFixed(2)),
    weightsApplied: {
      base: 50,
      issuerAgeWeight,
      successRateWeight,
      volumeConfidenceWeight,
      cleanRecentWeight,
      tamperPenalty,
      revokedPenalty,
      anomalyPenalty
    }
  };
}

async function initializeTrustScore({ issuerUserId, tenantId }) {
  const existing = await TrustScore.findOne({ issuerUserId });

  if (existing) {
    return existing;
  }

  return TrustScore.create({
    issuerUserId,
    tenantId,
    currentScore: 0,
    scoreBand: "unrated",
    lastComputedAt: new Date(),
    history: [],
    metrics: {
      totalVerifications: 0,
      successfulVerifications: 0,
      tamperedDetections: 0,
      revokedDocuments: 0,
      cleanRecentVerifications: 0,
      anomalyEventsLast24h: 0
    }
  });
}

async function recomputeTrustScore({ issuerUserId, triggerType, triggerRef = null }) {
  const issuer = await User.findById(issuerUserId).lean();

  if (!issuer) {
    throw new Error("Issuer user not found for trust score recompute");
  }

  const [attempts, documents, trustScore] = await Promise.all([
    VerificationAttempt.find({ issuerUserId }).lean(),
    Document.find({ issuerUserId }).lean(),
    initializeTrustScore({ issuerUserId, tenantId: issuer.tenantId || "platform" })
  ]);

  const now = Date.now();
  const recent30d = now - 30 * 24 * 60 * 60 * 1000;
  const recent24h = now - 24 * 60 * 60 * 1000;
  const userCreatedAt = issuer.createdAt ? new Date(issuer.createdAt).getTime() : now;
  const issuerAgeDays = (now - userCreatedAt) / (24 * 60 * 60 * 1000);

  const completedAttempts = attempts.filter((attempt) => attempt.resultStatus !== "pending" && attempt.resultStatus !== "error");
  const successfulVerifications = completedAttempts.filter((attempt) => attempt.resultStatus === "verified").length;
  const tamperedDetections = completedAttempts.filter((attempt) => attempt.resultStatus === "tampered").length;
  const cleanRecentVerifications = completedAttempts.filter(
    (attempt) => attempt.resultStatus === "verified" && new Date(attempt.createdAt).getTime() >= recent30d
  ).length;
  const suspiciousAttemptsLast24h = completedAttempts.filter(
    (attempt) =>
      (attempt.resultStatus === "suspicious" || attempt.resultStatus === "tampered") &&
      new Date(attempt.createdAt).getTime() >= recent24h
  ).length;
  const totalAttemptsLast24h = completedAttempts.filter((attempt) => new Date(attempt.createdAt).getTime() >= recent24h).length;
  const revokedDocuments = documents.filter((document) => document.status === "revoked" || document.status === "superseded").length;
  const totalIssuedDocuments = documents.length;

  const formulaInputs = {
    issuerAgeDays,
    totalVerifications: completedAttempts.length,
    successfulVerifications,
    cleanRecentVerifications,
    tamperedDetections,
    revokedDocuments,
    suspiciousAttemptsLast24h,
    totalAttemptsLast24h,
    totalIssuedDocuments
  };

  const { score, weightsApplied } = computeScore(formulaInputs);
  const previousScore = trustScore.currentScore;

  trustScore.currentScore = score;
  trustScore.scoreBand = getScoreBand(score);
  trustScore.lastComputedAt = new Date();
  trustScore.metrics = {
    totalVerifications: completedAttempts.length,
    successfulVerifications,
    tamperedDetections,
    revokedDocuments,
    cleanRecentVerifications,
    anomalyEventsLast24h: suspiciousAttemptsLast24h
  };
  trustScore.history.push({
    eventId: uuidv4(),
    triggerType,
    triggerRef,
    previousScore,
    newScore: score,
    delta: Number((score - previousScore).toFixed(2)),
    formulaInputs,
    weightsApplied,
    computedAt: new Date()
  });

  await trustScore.save();
  await invalidateTrustScore(issuerUserId);
  await setTrustScore(issuerUserId, {
    issuerUserId,
    currentScore: trustScore.currentScore,
    scoreBand: trustScore.scoreBand,
    metrics: trustScore.metrics,
    lastComputedAt: trustScore.lastComputedAt
  });

  return trustScore;
}

async function getTrustScoreByIssuer(issuerUserId) {
  return TrustScore.findOne({ issuerUserId }).lean();
}

module.exports = {
  initializeTrustScore,
  recomputeTrustScore,
  getTrustScoreByIssuer,
  computeScore
};
