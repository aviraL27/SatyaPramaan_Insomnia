const express = require("express");
const { firebaseAuth } = require("../../middleware/firebaseAuth");
const { optionalFirebaseAuth } = require("../../middleware/optionalFirebaseAuth");
const { requireRole } = require("../../middleware/requireRole");
const { validateRequest } = require("../../middleware/validateRequest");
const { uploadHandler } = require("../../middleware/uploadHandler");
const controller = require("./documents.controller");

const router = express.Router();

router.get("/", firebaseAuth, requireRole("institution_admin", "institution_operator"), controller.listDocuments);
router.get(
  "/:documentId/download",
  optionalFirebaseAuth,
  validateRequest(controller.downloadSchema),
  controller.downloadDocument
);
router.get("/:documentId", firebaseAuth, requireRole("institution_admin", "institution_operator"), controller.getDocument);
router.post(
  "/:documentId/revoke",
  firebaseAuth,
  requireRole("institution_admin"),
  validateRequest(controller.revokeSchema),
  controller.revokeDocument
);
router.post(
  "/:documentId/replace",
  firebaseAuth,
  requireRole("institution_admin", "institution_operator"),
  uploadHandler.single("file"),
  validateRequest(controller.replaceSchema),
  controller.replaceDocument
);
router.get(
  "/:documentId/versions",
  firebaseAuth,
  requireRole("institution_admin", "institution_operator"),
  controller.listVersions
);

module.exports = router;
