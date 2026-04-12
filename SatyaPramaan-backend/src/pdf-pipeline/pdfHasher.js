const crypto = require("crypto");
const { canonicalize } = require("./pdfCanonicalizer");

function sha256(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function buildCanonicalContentHash(payload) {
  return sha256(canonicalize(payload));
}

module.exports = { sha256, buildCanonicalContentHash };
