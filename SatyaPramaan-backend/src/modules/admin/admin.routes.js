const express = require("express");
const { firebaseAuth } = require("../../middleware/firebaseAuth");
const { requireRole } = require("../../middleware/requireRole");
const controller = require("./admin.controller");

const router = express.Router();

router.use(firebaseAuth, requireRole("platform_admin"));
router.get("/tenants", controller.listTenants);
router.post("/users/:userId/suspend", controller.suspendUser);
router.post("/recompute-trust/:issuerUserId", controller.recomputeTrust);
router.post("/cache/flush-document/:documentId", controller.flushDocumentCache);

module.exports = router;
