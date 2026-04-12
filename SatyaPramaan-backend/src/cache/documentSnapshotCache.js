const { redis } = require("../config/redis");
const { cacheKeys, CACHE_TTLS } = require("./keys");

async function getDocumentSnapshot(documentId) {
  const cached = await redis.get(cacheKeys.documentVerifySnapshot(documentId));
  return cached ? JSON.parse(cached) : null;
}

async function setDocumentSnapshot(documentId, payload) {
  await redis.set(
    cacheKeys.documentVerifySnapshot(documentId),
    JSON.stringify(payload),
    "EX",
    CACHE_TTLS.documentVerifySnapshot
  );
}

async function invalidateDocumentSnapshot(documentId) {
  await redis.del(cacheKeys.documentVerifySnapshot(documentId));
}

module.exports = { getDocumentSnapshot, setDocumentSnapshot, invalidateDocumentSnapshot };
