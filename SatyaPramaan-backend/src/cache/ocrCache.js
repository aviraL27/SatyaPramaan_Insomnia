const { redis } = require("../config/redis");
const { cacheKeys, CACHE_TTLS } = require("./keys");

async function getOcrExtraction(documentId, fileHash) {
  const cached = await redis.get(cacheKeys.ocrExtraction(documentId, fileHash));
  return cached ? JSON.parse(cached) : null;
}

async function setOcrExtraction(documentId, fileHash, payload) {
  await redis.set(
    cacheKeys.ocrExtraction(documentId, fileHash),
    JSON.stringify(payload),
    "EX",
    CACHE_TTLS.ocrExtraction
  );
}

module.exports = {
  getOcrExtraction,
  setOcrExtraction
};
