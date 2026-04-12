const express = require("express");
const { firebaseAuth } = require("../../middleware/firebaseAuth");
const { requireRole } = require("../../middleware/requireRole");
const controller = require("./trustScore.controller");

const router = express.Router();

router.get("/trust/:issuerUserId", controller.getTrustScore);
router.get(
  "/trust/:issuerUserId/history",
  firebaseAuth,
  requireRole("institution_admin", "institution_operator", "verifier", "platform_admin"),
  controller.getTrustHistory
);

module.exports = router;
