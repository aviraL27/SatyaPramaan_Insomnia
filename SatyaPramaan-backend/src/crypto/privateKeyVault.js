const crypto = require("crypto");
const { env } = require("../config/env");
const { AppError } = require("../utils/AppError");

function getMasterKeyBuffer() {
  if (!env.PRIVATE_KEY_MASTER_KEY_BASE64) {
    throw new AppError("PRIVATE_KEY_MASTER_KEY_BASE64 is not configured", 500);
  }

  const key = Buffer.from(env.PRIVATE_KEY_MASTER_KEY_BASE64, "base64");

  if (key.length !== 32) {
    throw new AppError("Private key master key must be 32 bytes after base64 decode", 500);
  }

  return key;
}

function encryptPrivateKey(privateKeyPem) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getMasterKeyBuffer(), iv);
  const ciphertext = Buffer.concat([cipher.update(privateKeyPem, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    keyVersion: env.PRIVATE_KEY_MASTER_KEY_VERSION,
    encryptedAt: new Date()
  };
}

function decryptPrivateKey(envelope) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getMasterKeyBuffer(),
    Buffer.from(envelope.iv, "base64")
  );

  decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final()
  ]);

  return plaintext.toString("utf8");
}

module.exports = { encryptPrivateKey, decryptPrivateKey };
