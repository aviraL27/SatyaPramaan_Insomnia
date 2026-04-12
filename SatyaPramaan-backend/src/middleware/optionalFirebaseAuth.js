const User = require("../models/User.model");
const { getFirebaseAdmin } = require("../config/firebase");

async function optionalFirebaseAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const [scheme, token] = authHeader.split(" ");

    if (!token || String(scheme || "").toLowerCase() !== "bearer") {
      return next();
    }

    const admin = getFirebaseAdmin();
    const decoded = await admin.auth().verifyIdToken(token);
    const user = await User.findOne({ firebaseUid: decoded.uid }).lean();

    if (!user || user.status !== "active") {
      return next();
    }

    req.auth = {
      firebaseUid: decoded.uid,
      userId: String(user._id),
      tenantId: user.tenantId || null,
      role: user.role,
      email: user.email
    };

    return next();
  } catch (error) {
    return next();
  }
}

module.exports = { optionalFirebaseAuth };
