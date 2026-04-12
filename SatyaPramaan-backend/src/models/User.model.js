const { Schema, model } = require("mongoose");

const EncryptedPrivateKeySchema = new Schema(
  {
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
    keyVersion: { type: Number, required: true },
    encryptedAt: { type: Date, required: true }
  },
  { _id: false }
);

const UserSchema = new Schema(
  {
    tenantId: { type: String, index: true, default: null },
    firebaseUid: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    emailVerified: { type: Boolean, default: false },
    displayName: { type: String, required: true, trim: true },
    role: {
      type: String,
      enum: ["institution_admin", "institution_operator", "verifier", "platform_admin"],
      required: true,
      index: true
    },
    status: {
      type: String,
      enum: ["pending", "active", "suspended", "disabled"],
      default: "active",
      index: true
    },
    institutionName: { type: String, trim: true },
    institutionCode: { type: String, trim: true, unique: true, sparse: true },
    institutionType: { type: String, trim: true },
    publicIssuerProfile: {
      website: String,
      supportEmail: String,
      supportPhone: String,
      description: String
    },
    contactPhone: { type: String, trim: true },
    address: {
      line1: String,
      line2: String,
      city: String,
      state: String,
      country: String,
      postalCode: String
    },
    rsaKeyVersion: { type: Number, default: 1 },
    rsaPublicKeyPem: { type: String },
    rsaPublicKeyFingerprint: { type: String },
    encryptedPrivateKey: { type: EncryptedPrivateKeySchema, default: null },
    trustScoreRef: { type: Schema.Types.ObjectId, ref: "TrustScore" },
    lastLoginAt: { type: Date }
  },
  {
    timestamps: true
  }
);

UserSchema.index({ tenantId: 1, role: 1 });
UserSchema.index({ tenantId: 1, status: 1 });

module.exports = model("User", UserSchema);
