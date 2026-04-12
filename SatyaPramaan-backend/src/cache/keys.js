const CACHE_TTLS = {
  issuerPublic: 60 * 60,
  trustCurrent: 10 * 60,
  documentVerifySnapshot: 15 * 60,
  pdfPositions: 24 * 60 * 60,
  ocrExtraction: 24 * 60 * 60,
  verifyJob: 30 * 60,
  auditHead: 5 * 60
};

const cacheKeys = {
  issuerPublic: (issuerUserId) => `issuer:public:${issuerUserId}`,
  trustCurrent: (issuerUserId) => `trust:current:${issuerUserId}`,
  documentVerifySnapshot: (documentId) => `document:verifySnapshot:${documentId}`,
  pdfPositions: (documentId, fileHash) => `pdf:positions:${documentId}:${fileHash}`,
  ocrExtraction: (documentId, fileHash) => `ocr:extraction:${documentId}:${fileHash}`,
  verifyJob: (jobId) => `verifyjob:${jobId}`,
  verifyJobPayload: (jobId) => `verifyjob:payload:${jobId}`,
  verifyJobQueue: () => "verifyjob:queue",
  auditHead: () => "audit:head"
};

module.exports = { cacheKeys, CACHE_TTLS };
