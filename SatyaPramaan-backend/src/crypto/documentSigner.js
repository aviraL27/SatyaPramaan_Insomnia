const crypto = require("crypto");

function signPayload(payloadString, privateKeyPem) {
  return crypto.sign("RSA-SHA256", Buffer.from(payloadString), privateKeyPem).toString("base64");
}

function verifyPayload(payloadString, signatureBase64, publicKeyPem) {
  return crypto.verify(
    "RSA-SHA256",
    Buffer.from(payloadString),
    publicKeyPem,
    Buffer.from(signatureBase64, "base64")
  );
}

module.exports = { signPayload, verifyPayload };
