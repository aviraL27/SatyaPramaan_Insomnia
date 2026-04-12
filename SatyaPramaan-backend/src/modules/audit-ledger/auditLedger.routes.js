const express = require("express");
const { firebaseAuth } = require("../../middleware/firebaseAuth");
const { requireRole } = require("../../middleware/requireRole");
const { rateLimiter } = require("../../middleware/rateLimiter");
const controller = require("./auditLedger.controller");

const router = express.Router();

router.get("/audit", firebaseAuth, requireRole("institution_admin", "institution_operator", "platform_admin"), controller.listEntries);
router.get("/audit/:entryId", firebaseAuth, requireRole("institution_admin", "institution_operator", "platform_admin"), controller.getEntry);
router.post(
  "/audit/verify-chain",
  firebaseAuth,
  requireRole("institution_admin", "platform_admin"),
  rateLimiter({ key: "audit-verify", limit: 5, windowSeconds: 3600 }),
  controller.verifyChain
);
router.get(
  "/audit/document/:documentId",
  firebaseAuth,
  requireRole("institution_admin", "institution_operator", "platform_admin"),
  controller.listDocumentEntries
);
router.post(
  "/audit/anchor",
  firebaseAuth,
  requireRole("institution_admin", "platform_admin"),
  rateLimiter({ key: "audit-anchor", limit: 5, windowSeconds: 3600 }),
  controller.anchorChain
);
router.get(
  "/audit/anchors",
  firebaseAuth,
  requireRole("institution_admin", "institution_operator", "platform_admin"),
  controller.listAnchors
);
router.get(
  "/audit/anchor-status",
  firebaseAuth,
  requireRole("institution_admin", "institution_operator", "platform_admin"),
  controller.getAnchorStatus
);
router.post(
  "/audit/snapshot/export",
  firebaseAuth,
  requireRole("institution_admin", "institution_operator", "platform_admin"),
  rateLimiter({ key: "audit-snapshot-export", limit: 30, windowSeconds: 3600 }),
  controller.exportSignedSnapshot
);

module.exports = router;
