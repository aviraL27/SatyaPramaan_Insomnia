const express = require("express");
const { firebaseAuth } = require("../../middleware/firebaseAuth");
const { validateRequest } = require("../../middleware/validateRequest");
const controller = require("./auth.controller");

const router = express.Router();

router.post("/bootstrap", validateRequest(controller.bootstrapSchema), controller.bootstrap);
router.get("/me", firebaseAuth, controller.me);
router.patch("/me", firebaseAuth, validateRequest(controller.updateMeSchema), controller.updateMe);

module.exports = router;
