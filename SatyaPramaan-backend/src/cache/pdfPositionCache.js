const { redis } = require("../config/redis");
const { cacheKeys, CACHE_TTLS } = require("./keys");

async function getPdfPositions(documentId, fileHash) {
  const cached = await redis.get(cacheKeys.pdfPositions(documentId, fileHash));
  return cached ? JSON.parse(cached) : null;
}

async function setPdfPositions(documentId, fileHash, payload) {
  await redis.set(cacheKeys.pdfPositions(documentId, fileHash), JSON.stringify(payload), "EX", CACHE_TTLS.pdfPositions);
}

module.exports = { getPdfPositions, setPdfPositions };
