const { redis } = require("../config/redis");
const { cacheKeys, CACHE_TTLS } = require("./keys");

async function getIssuerProfile(issuerUserId) {
  const cached = await redis.get(cacheKeys.issuerPublic(issuerUserId));
  return cached ? JSON.parse(cached) : null;
}

async function setIssuerProfile(issuerUserId, payload) {
  await redis.set(cacheKeys.issuerPublic(issuerUserId), JSON.stringify(payload), "EX", CACHE_TTLS.issuerPublic);
}

async function invalidateIssuerProfile(issuerUserId) {
  await redis.del(cacheKeys.issuerPublic(issuerUserId));
}

module.exports = { getIssuerProfile, setIssuerProfile, invalidateIssuerProfile };
