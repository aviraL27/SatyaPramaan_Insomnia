const { asyncHandler } = require("../../utils/asyncHandler");
const auditLedgerService = require("./auditLedger.service");
const blockchainAnchorService = require("./blockchainAnchor.service");
const auditSnapshotService = require("./auditSnapshot.service");
const { AppError } = require("../../utils/AppError");

const listEntries = asyncHandler(async (req, res) => {
  const filter = req.auth.role === "platform_admin" ? {} : { tenantId: req.auth.tenantId };
  const data = await auditLedgerService.listAuditEntries(filter, { limit: req.query.limit });
  res.json({ data });
});

const getEntry = asyncHandler(async (req, res) => {
  const filter = req.auth.role === "platform_admin"
    ? { entryId: req.params.entryId }
    : { entryId: req.params.entryId, tenantId: req.auth.tenantId };
  const entries = await auditLedgerService.listAuditEntries(filter, { limit: 1 });
  const data = entries[0];

  if (!data) {
    throw new AppError("Audit entry not found", 404);
  }

  res.json({ data });
});

const verifyChain = asyncHandler(async (req, res) => {
  const data = await auditLedgerService.verifyChain({
    tenantId: req.auth.role === "platform_admin" ? null : req.auth.tenantId
  });
  res.json({ data });
});

const listDocumentEntries = asyncHandler(async (req, res) => {
  const filter = req.auth.role === "platform_admin"
    ? { documentId: req.params.documentId }
    : { tenantId: req.auth.tenantId, documentId: req.params.documentId };
  const data = await auditLedgerService.listAuditEntries(filter, { limit: req.query.limit });
  res.json({ data });
});

const anchorChain = asyncHandler(async (req, res) => {
  const tenantId = req.auth.role === "platform_admin" ? null : req.auth.tenantId;
  const verification = await auditLedgerService.verifyChain({ tenantId });

  if (!verification.isValid) {
    throw new AppError("Audit chain is invalid. Fix integrity issues before blockchain anchoring", 409, verification);
  }

  const head = await auditLedgerService.getLatestAuditHead({ tenantId });

  if (!head) {
    throw new AppError("No audit entries available to anchor", 404);
  }

  const data = await blockchainAnchorService.anchorAuditHead({
    tenantId: head.tenantId,
    sequenceNumber: head.sequenceNumber,
    anchoredHash: head.currentEntryHash,
    actorId: req.auth.userId
  });

  res.status(201).json({ data });
});

const listAnchors = asyncHandler(async (req, res) => {
  const tenantId = req.auth.role === "platform_admin" ? null : req.auth.tenantId;
  const data = await blockchainAnchorService.listAnchors({ tenantId, limit: req.query.limit });
  res.json({ data });
});

const getAnchorStatus = asyncHandler(async (req, res) => {
  const blockchainEnabled = blockchainAnchorService.isBlockchainConfigured();
  res.json({
    data: {
      blockchainEnabled,
      mode: blockchainEnabled ? "blockchain" : "tamper_evident_snapshot"
    }
  });
});

const exportSignedSnapshot = asyncHandler(async (req, res) => {
  const tenantId = req.auth.role === "platform_admin" ? null : req.auth.tenantId;
  const data = await auditSnapshotService.exportSignedSnapshot({
    tenantId,
    actorId: req.auth.userId
  });
  res.json({ data });
});

module.exports = {
  listEntries,
  getEntry,
  verifyChain,
  listDocumentEntries,
  anchorChain,
  listAnchors,
  getAnchorStatus,
  exportSignedSnapshot
};
