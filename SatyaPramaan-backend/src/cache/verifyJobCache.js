const { redis } = require("../config/redis");
const { cacheKeys, CACHE_TTLS } = require("./keys");

async function getVerifyJob(jobId) {
  const cached = await redis.get(cacheKeys.verifyJob(jobId));
  return cached ? JSON.parse(cached) : null;
}

async function setVerifyJob(jobId, payload) {
  await redis.set(cacheKeys.verifyJob(jobId), JSON.stringify(payload), "EX", CACHE_TTLS.verifyJob);
}

async function setVerifyJobIfAbsent(jobId, payload) {
  const result = await redis.set(
    cacheKeys.verifyJob(jobId),
    JSON.stringify(payload),
    "EX",
    CACHE_TTLS.verifyJob,
    "NX"
  );

  return result === "OK";
}

async function getVerifyJobPayload(jobId) {
  const cached = await redis.get(cacheKeys.verifyJobPayload(jobId));
  return cached ? JSON.parse(cached) : null;
}

async function setVerifyJobPayload(jobId, payload) {
  await redis.set(cacheKeys.verifyJobPayload(jobId), JSON.stringify(payload), "EX", CACHE_TTLS.verifyJob);
}

async function deleteVerifyJobPayload(jobId) {
  await redis.del(cacheKeys.verifyJobPayload(jobId));
}

async function enqueueVerifyJob(jobId) {
  await redis.lpush(cacheKeys.verifyJobQueue(), jobId);
}

async function dequeueVerifyJob({ timeoutSeconds = 5, client = redis } = {}) {
  const result = await client.brpop(cacheKeys.verifyJobQueue(), timeoutSeconds);
  return Array.isArray(result) ? result[1] : null;
}

module.exports = {
  getVerifyJob,
  setVerifyJob,
  setVerifyJobIfAbsent,
  getVerifyJobPayload,
  setVerifyJobPayload,
  deleteVerifyJobPayload,
  enqueueVerifyJob,
  dequeueVerifyJob
};
