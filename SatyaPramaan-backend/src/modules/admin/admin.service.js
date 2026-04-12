const User = require("../../models/User.model");
const TrustScore = require("../../models/TrustScore.model");
const { invalidateIssuerProfile } = require("../../cache/issuerCache");
const { invalidateDocumentSnapshot } = require("../../cache/documentSnapshotCache");
const { appendAuditEntry } = require("../audit-ledger/auditLedger.service");
const { recomputeTrustScore } = require("../trust-score/trustScore.service");
const { AppError } = require("../../utils/AppError");

async function suspendUser(userId) {
  const user = await User.findByIdAndUpdate(userId, { $set: { status: "suspended" } }, { new: true }).lean();

  if (!user) {
    throw new AppError("User not found", 404);
  }

  await invalidateIssuerProfile(userId);
  await appendAuditEntry({
    tenantId: user.tenantId || "platform",
    action: "USER_SUSPENDED",
    actorId: userId,
    actorType: "platform_admin",
    payload: { userId }
  });

  return user;
}

async function recomputeIssuerTrust(issuerUserId) {
  return recomputeTrustScore({
    issuerUserId,
    triggerType: "manual_admin_adjustment",
    triggerRef: issuerUserId
  });
}

async function flushDocumentCache(documentId) {
  await invalidateDocumentSnapshot(documentId);
  return { documentId, flushed: true };
}

async function listTenants({ limit = 100 } = {}) {
  const normalizedLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const grouped = await User.aggregate([
    { $match: { tenantId: { $ne: null } } },
    {
      $group: {
        _id: "$tenantId",
        totalUsers: { $sum: 1 },
        activeUsers: {
          $sum: {
            $cond: [{ $eq: ["$status", "active"] }, 1, 0]
          }
        },
        institutionAdmins: {
          $sum: {
            $cond: [{ $eq: ["$role", "institution_admin"] }, 1, 0]
          }
        },
        createdAt: { $min: "$createdAt" }
      }
    },
    { $sort: { _id: 1 } },
    { $limit: normalizedLimit }
  ]);

  const tenantIds = grouped.map((entry) => entry._id);
  const trustCounts = await TrustScore.aggregate([
    { $match: { tenantId: { $in: tenantIds } } },
    {
      $group: {
        _id: "$tenantId",
        issuersWithTrust: { $sum: 1 },
        avgScore: { $avg: "$currentScore" }
      }
    }
  ]);
  const trustByTenant = trustCounts.reduce((accumulator, entry) => {
    accumulator[entry._id] = entry;
    return accumulator;
  }, {});

  return grouped.map((entry) => ({
    tenantId: entry._id,
    totalUsers: entry.totalUsers,
    activeUsers: entry.activeUsers,
    institutionAdmins: entry.institutionAdmins,
    issuersWithTrust: trustByTenant[entry._id]?.issuersWithTrust || 0,
    averageTrustScore: Number((trustByTenant[entry._id]?.avgScore || 0).toFixed(2)),
    createdAt: entry.createdAt
  }));
}

module.exports = {
  listTenants,
  suspendUser,
  recomputeIssuerTrust,
  flushDocumentCache
};
