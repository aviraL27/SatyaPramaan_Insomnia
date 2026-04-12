const Redis = require("ioredis");
const { env } = require("./env");

const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 2
});

async function connectRedis() {
  if (redis.status === "ready") {
    return redis;
  }

  await redis.connect();
  return redis;
}

module.exports = { redis, connectRedis };
