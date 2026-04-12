const crypto = require("crypto");
const { env } = require("../config/env");

function generateInstitutionKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: env.DEFAULT_RSA_MODULUS_LENGTH,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" }
  });

  const fingerprint = crypto.createHash("sha256").update(publicKey).digest("hex");

  return { publicKey, privateKey, fingerprint };
}

module.exports = { generateInstitutionKeyPair };
