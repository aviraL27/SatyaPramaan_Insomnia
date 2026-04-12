const crypto = require("crypto");
const { env } = require("../../config/env");
const { canonicalize } = require("../../pdf-pipeline/pdfCanonicalizer");
const { AppError } = require("../../utils/AppError");
const auditLedgerService = require("./auditLedger.service");

function resolveSnapshotSigningKey() {
  const raw = String(env.PRIVATE_KEY_MASTER_KEY_BASE64 || "").trim();

  if (!raw) {
    throw new AppError("Snapshot signing key is not configured", 409);
  }

  const decoded = Buffer.from(raw, "base64");

  if (!decoded.length) {
    throw new AppError("Snapshot signing key is invalid", 409);
  }

  return decoded;
}

async function exportSignedSnapshot({ tenantId, actorId }) {
  const verification = await auditLedgerService.verifyChain({ tenantId });

  if (!verification.isValid) {
    throw new AppError("Audit chain is invalid. Cannot export signed snapshot", 409, verification);
  }

  const head = await auditLedgerService.getLatestAuditHead({ tenantId });

  if (!head) {
    throw new AppError("No audit entries available for snapshot export", 404);
  }

  const generatedAt = new Date().toISOString();
  const snapshot = {
    type: "digisecure_audit_snapshot_v1",
    tenantId: head.tenantId,
    sequenceNumber: head.sequenceNumber,
    auditHeadHash: head.currentEntryHash,
    chainValid: true,
    checkedEntries: verification.checkedEntries,
    generatedAt,
    generatedBy: actorId
  };

  const signingKey = resolveSnapshotSigningKey();
  const canonical = canonicalize(snapshot);
  const signature = crypto.createHmac("sha256", signingKey).update(canonical).digest("hex");

  return {
    snapshot,
    signature: {
      algorithm: "HMAC-SHA256",
      value: signature,
      keyVersion: Number(env.PRIVATE_KEY_MASTER_KEY_VERSION || 1)
    }
  };
}

module.exports = {
  exportSignedSnapshot
};
