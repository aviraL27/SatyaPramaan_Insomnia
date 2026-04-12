const express = require("express");
const { firebaseAuth } = require("../../middleware/firebaseAuth");
const { requireRole } = require("../../middleware/requireRole");
const controller = require("./users.controller");

const router = express.Router();

router.get("/:userId", firebaseAuth, requireRole("platform_admin"), controller.getUser);

module.exports = router;
