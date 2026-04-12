const User = require("../models/User.model");
const { getFirebaseAdmin } = require("../config/firebase");
const { AppError } = require("../utils/AppError");

async function firebaseAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const [, token] = authHeader.split(" ");

    if (!token) {
      throw new AppError("Missing bearer token", 401);
    }

    const admin = getFirebaseAdmin();
    const decoded = await admin.auth().verifyIdToken(token);
    const user = await User.findOne({ firebaseUid: decoded.uid }).lean();

    if (!user) {
      throw new AppError("User not found for Firebase identity", 401);
    }

    if (user.status !== "active") {
      throw new AppError("User account is not active", 403);
    }

    req.auth = {
      firebaseUid: decoded.uid,
      userId: String(user._id),
      tenantId: user.tenantId || null,
      role: user.role,
      email: user.email
    };

    next();
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(error.message || "Authentication failed", 401));
  }
}

module.exports = { firebaseAuth };
