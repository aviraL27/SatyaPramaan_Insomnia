const { signPayload } = require("./documentSigner");
const { canonicalize } = require("../pdf-pipeline/pdfCanonicalizer");

function buildQrPayload({ documentId, tenantId, signatureId, contentHash, verificationToken, issuedAt, privateKeyPem }) {
  const payload = {
    documentId,
    tenantId,
    signatureId,
    contentHash,
    verificationToken,
    issuedAt
  };

  const qrSignature = signPayload(canonicalize(payload), privateKeyPem);

  return {
    ...payload,
    qrSignature
  };
}

module.exports = { buildQrPayload };
