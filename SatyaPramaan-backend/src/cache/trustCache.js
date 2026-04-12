const { redis } = require("../config/redis");
const { cacheKeys, CACHE_TTLS } = require("./keys");

async function getTrustScore(issuerUserId) {
  const cached = await redis.get(cacheKeys.trustCurrent(issuerUserId));
  return cached ? JSON.parse(cached) : null;
}

async function setTrustScore(issuerUserId, payload) {
  await redis.set(cacheKeys.trustCurrent(issuerUserId), JSON.stringify(payload), "EX", CACHE_TTLS.trustCurrent);
}

async function invalidateTrustScore(issuerUserId) {
  await redis.del(cacheKeys.trustCurrent(issuerUserId));
}

module.exports = { getTrustScore, setTrustScore, invalidateTrustScore };
