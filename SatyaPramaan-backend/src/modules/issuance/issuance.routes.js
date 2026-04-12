const express = require("express");
const { firebaseAuth } = require("../../middleware/firebaseAuth");
const { requireRole } = require("../../middleware/requireRole");
const { uploadHandler } = require("../../middleware/uploadHandler");
const { validateRequest } = require("../../middleware/validateRequest");
const controller = require("./issuance.controller");

const router = express.Router();

router.post(
  "/issue",
  firebaseAuth,
  requireRole("institution_admin", "institution_operator"),
  uploadHandler.single("file"),
  validateRequest(controller.issueDocumentSchema),
  controller.issueDocument
);

module.exports = router;
