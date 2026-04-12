const crypto = require("crypto");
const { canonicalize } = require("../pdf-pipeline/pdfCanonicalizer");

function hashRequestBody(body) {
  return crypto.createHash("sha256").update(canonicalize(body || {})).digest("hex");
}

function getIdempotencyKey(req) {
  const raw = req?.headers?.["idempotency-key"];
  const headerValue = Array.isArray(raw) ? raw[0] : raw;

  if (typeof headerValue !== "string") {
    return undefined;
  }

  const normalized = headerValue.trim();
  return normalized.length ? normalized : undefined;
}

module.exports = { hashRequestBody, getIdempotencyKey };
