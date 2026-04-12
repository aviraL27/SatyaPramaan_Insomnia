const { redis } = require("../config/redis");
const { AppError } = require("../utils/AppError");

function rateLimiter({ key, limit, windowSeconds, subject = defaultSubject }) {
  return async function limitMiddleware(req, res, next) {
    try {
      const now = Date.now();
      const subjectValue = subject(req);
      const redisKey = `ratelimit:${key}:${subjectValue}`;
      const windowStart = now - windowSeconds * 1000;

      await redis.zremrangebyscore(redisKey, 0, windowStart);
      await redis.zadd(redisKey, now, `${now}-${Math.random()}`);
      const count = await redis.zcard(redisKey);
      await redis.expire(redisKey, windowSeconds);

      if (count > limit) {
        throw new AppError("Rate limit exceeded", 429, { key, limit, windowSeconds });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

function defaultSubject(req) {
  return req.auth?.userId || req.ip;
}

module.exports = { rateLimiter };
