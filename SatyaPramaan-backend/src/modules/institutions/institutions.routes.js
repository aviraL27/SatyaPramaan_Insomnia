const express = require("express");
const { firebaseAuth } = require("../../middleware/firebaseAuth");
const { requireRole } = require("../../middleware/requireRole");
const { validateRequest } = require("../../middleware/validateRequest");
const controller = require("./institutions.controller");

const router = express.Router();

router.get("/profile", firebaseAuth, requireRole("institution_admin", "institution_operator"), controller.getProfile);
router.patch(
  "/profile",
  firebaseAuth,
  requireRole("institution_admin"),
  validateRequest(controller.updateProfileSchema),
  controller.updateProfile
);
router.post("/keys/rotate", firebaseAuth, requireRole("institution_admin"), controller.rotateKeys);
router.get("/public/:issuerUserId", controller.getPublicProfile);

module.exports = router;
