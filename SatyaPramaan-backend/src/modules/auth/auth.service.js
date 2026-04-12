const crypto = require("crypto");
const User = require("../../models/User.model");
const { generateInstitutionKeyPair } = require("../../crypto/rsaKeyManager");
const { encryptPrivateKey } = require("../../crypto/privateKeyVault");
const { initializeTrustScore } = require("../trust-score/trustScore.service");
const { appendAuditEntry } = require("../audit-ledger/auditLedger.service");
const { AppError } = require("../../utils/AppError");
const { sanitizeUser } = require("../../utils/serializers");

function buildTenantId(role, institutionCode) {
  if (role === "institution_admin" || role === "institution_operator") {
    if (!institutionCode) {
      throw new AppError("institutionCode is required for institution roles", 400);
    }

    return `tenant_${institutionCode.toLowerCase()}`;
  }

  return null;
}

async function bootstrapUser({ firebaseUser, profile }) {
  const existing = await User.findOne({ firebaseUid: firebaseUser.uid });

  if (existing) {
    return existing;
  }

  const tenantId = buildTenantId(profile.role, profile.institutionCode);
  const baseData = {
    tenantId,
    firebaseUid: firebaseUser.uid,
    email: firebaseUser.email,
    emailVerified: Boolean(firebaseUser.email_verified),
    displayName: profile.displayName || firebaseUser.name || firebaseUser.email,
    role: profile.role,
    status: "active",
    institutionName: profile.institutionName || null,
    institutionCode: profile.institutionCode || null,
    institutionType: profile.institutionType || null,
    publicIssuerProfile: profile.publicIssuerProfile || {},
    contactPhone: profile.contactPhone || null,
    address: profile.address || {}
  };

  if (profile.role === "institution_admin" || profile.role === "institution_operator") {
    const keys = generateInstitutionKeyPair();
    baseData.rsaKeyVersion = 1;
    baseData.rsaPublicKeyPem = keys.publicKey;
    baseData.rsaPublicKeyFingerprint = keys.fingerprint;
    baseData.encryptedPrivateKey = encryptPrivateKey(keys.privateKey);
  }

  const created = await User.create(baseData);

  if (created.tenantId) {
    const trustScore = await initializeTrustScore({
      issuerUserId: created._id,
      tenantId: created.tenantId
    });

    created.trustScoreRef = trustScore._id;
    await created.save();
  }

  await appendAuditEntry({
    tenantId: created.tenantId || "platform",
    action: "USER_BOOTSTRAPPED",
    actorId: String(created._id),
    actorType: created.role === "platform_admin" ? "platform_admin" : "institution_user",
    payload: {
      userId: String(created._id),
      firebaseUid: created.firebaseUid,
      role: created.role,
      tenantId: created.tenantId
    }
  });

  return sanitizeUser(created);
}

async function getCurrentUser(userId) {
  const user = await User.findById(userId).lean();

  if (!user) {
    throw new AppError("User not found", 404);
  }

  return sanitizeUser(user);
}

async function updateCurrentUser(userId, updates) {
  const allowed = {
    displayName: updates.displayName,
    contactPhone: updates.contactPhone,
    address: updates.address
  };

  const user = await User.findByIdAndUpdate(userId, { $set: allowed }, { new: true }).lean();

  if (!user) {
    throw new AppError("User not found", 404);
  }

  await appendAuditEntry({
    tenantId: user.tenantId || "platform",
    action: "USER_PROFILE_UPDATED",
    actorId: userId,
    actorType: user.role === "platform_admin" ? "platform_admin" : "institution_user",
    payload: {
      userId,
      updatedFields: Object.keys(allowed).filter((key) => allowed[key] !== undefined),
      checksum: crypto.createHash("sha256").update(JSON.stringify(allowed)).digest("hex")
    }
  });

  return sanitizeUser(user);
}

module.exports = {
  bootstrapUser,
  getCurrentUser,
  updateCurrentUser
};
