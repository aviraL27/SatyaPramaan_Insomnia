const { asyncHandler } = require("../../utils/asyncHandler");
const adminService = require("./admin.service");

const listTenants = asyncHandler(async (req, res) => {
  const data = await adminService.listTenants({ limit: req.query.limit });
  res.json({ data });
});

const suspendUser = asyncHandler(async (req, res) => {
  const data = await adminService.suspendUser(req.params.userId);
  res.json({ data });
});

const recomputeTrust = asyncHandler(async (req, res) => {
  const data = await adminService.recomputeIssuerTrust(req.params.issuerUserId);
  res.json({ data });
});

const flushDocumentCache = asyncHandler(async (req, res) => {
  const data = await adminService.flushDocumentCache(req.params.documentId);
  res.json({ data });
});

module.exports = {
  listTenants,
  suspendUser,
  recomputeTrust,
  flushDocumentCache
};
