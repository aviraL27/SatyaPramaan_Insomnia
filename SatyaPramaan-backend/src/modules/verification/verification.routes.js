const express = require("express");
const { firebaseAuth } = require("../../middleware/firebaseAuth");
const { optionalFirebaseAuth } = require("../../middleware/optionalFirebaseAuth");
const { requireRole } = require("../../middleware/requireRole");
const { rateLimiter } = require("../../middleware/rateLimiter");
const { validateRequest } = require("../../middleware/validateRequest");
const { uploadHandler } = require("../../middleware/uploadHandler");
const controller = require("./verification.controller");

const router = express.Router();

router.post(
  "/public/verify/qr",
  rateLimiter({ key: "public-verify-qr", limit: 60, windowSeconds: 60, subject: (req) => req.ip }),
  validateRequest(controller.qrSchema),
  controller.verifyQr
);
router.post(
  "/public/verify/upload",
  rateLimiter({ key: "public-verify-upload", limit: 10, windowSeconds: 600, subject: (req) => req.ip }),
  uploadHandler.single("file"),
  validateRequest(controller.uploadSchema),
  controller.verifyUpload
);
router.post(
  "/verify/upload",
  firebaseAuth,
  requireRole("verifier", "institution_admin", "institution_operator"),
  rateLimiter({ key: "auth-verify-upload", limit: 30, windowSeconds: 3600 }),
  uploadHandler.single("file"),
  validateRequest(controller.uploadSchema),
  controller.verifyUpload
);
router.get("/verify/jobs/:jobId", optionalFirebaseAuth, controller.getJob);
router.get("/verify/attempts/:attemptId", optionalFirebaseAuth, controller.getAttempt);

module.exports = router;
