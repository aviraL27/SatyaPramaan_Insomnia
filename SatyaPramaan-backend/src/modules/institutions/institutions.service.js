const User = require("../../models/User.model");
const { generateInstitutionKeyPair } = require("../../crypto/rsaKeyManager");
const { encryptPrivateKey } = require("../../crypto/privateKeyVault");
const { appendAuditEntry } = require("../audit-ledger/auditLedger.service");
const { invalidateIssuerProfile, getIssuerProfile, setIssuerProfile } = require("../../cache/issuerCache");
const { AppError } = require("../../utils/AppError");
const { sanitizeUser } = require("../../utils/serializers");

async function getInstitutionProfile(userId) {
  const user = await User.findById(userId).lean();

  if (!user) {
    throw new AppError("Institution profile not found", 404);
  }

  return sanitizeUser(user);
}

async function updateInstitutionProfile(userId, updates) {
  const allowed = {
    institutionName: updates.institutionName,
    institutionType: updates.institutionType,
    publicIssuerProfile: updates.publicIssuerProfile,
    contactPhone: updates.contactPhone,
    address: updates.address
  };

  const user = await User.findByIdAndUpdate(userId, { $set: allowed }, { new: true }).lean();

  if (!user) {
    throw new AppError("Institution profile not found", 404);
  }

  await invalidateIssuerProfile(userId);
  await appendAuditEntry({
    tenantId: user.tenantId,
    action: "INSTITUTION_PROFILE_UPDATED",
    actorId: userId,
    actorType: "institution_user",
    payload: {
      userId,
      updatedFields: Object.keys(allowed).filter((key) => allowed[key] !== undefined)
    }
  });

  return sanitizeUser(user);
}

async function rotateKeys(userId) {
  const user = await User.findById(userId);

  if (!user) {
    throw new AppError("Institution not found", 404);
  }

  const keys = generateInstitutionKeyPair();
  user.rsaKeyVersion += 1;
  user.rsaPublicKeyPem = keys.publicKey;
  user.rsaPublicKeyFingerprint = keys.fingerprint;
  user.encryptedPrivateKey = encryptPrivateKey(keys.privateKey);
  await user.save();

  await invalidateIssuerProfile(userId);
  await appendAuditEntry({
    tenantId: user.tenantId,
    action: "INSTITUTION_KEYS_ROTATED",
    actorId: String(user._id),
    actorType: "institution_user",
    payload: {
      userId: String(user._id),
      rsaKeyVersion: user.rsaKeyVersion,
      rsaPublicKeyFingerprint: user.rsaPublicKeyFingerprint
    }
  });

  return sanitizeUser(user);
}

async function getPublicInstitutionProfile(issuerUserId) {
  const cached = await getIssuerProfile(issuerUserId);

  if (cached) {
    return cached;
  }

  const user = await User.findById(issuerUserId).lean();

  if (!user) {
    throw new AppError("Issuer not found", 404);
  }

  const payload = {
    issuerUserId: String(user._id),
    institutionName: user.institutionName,
    institutionType: user.institutionType,
    publicIssuerProfile: user.publicIssuerProfile || {},
    rsaPublicKeyFingerprint: user.rsaPublicKeyFingerprint,
    status: user.status
  };

  await setIssuerProfile(issuerUserId, payload);

  return payload;
}

module.exports = {
  getInstitutionProfile,
  updateInstitutionProfile,
  rotateKeys,
  getPublicInstitutionProfile
};
