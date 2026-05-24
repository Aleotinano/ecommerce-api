import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import { getRedis } from "../lib/redis.js";
import { DEFAULTS } from "../config.js";
import { logger } from "../lib/logger.js";

const isProd = DEFAULTS.NODE_ENV === "production";

const createStore = () => {
  const redis = getRedis();
  if (!redis) {
    logger.warn("redis unavailable, rate limiting will use in-memory store");
    return undefined;
  }
  return new RedisStore({
    sendCommand: async (...args) => redis.call(...args),
    prefix: "rl:",
  });
};

const rateLimitHandler = (req, res, _next, options) => {
  const resetTime = req.rateLimit?.resetTime;
  const retryAfterSeconds = resetTime
    ? Math.max(0, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
    : Math.ceil((options.windowMs ?? 0) / 1000);

  if (retryAfterSeconds > 0) {
    res.setHeader("Retry-After", String(retryAfterSeconds));
  }

  const identifier = req.body?.email || req.ip;
  logger.warn(
    { identifier, endpoint: req.path, remaining: req.rateLimit?.remaining },
    "rate limit exceeded"
  );

  return res.status(options.statusCode ?? 429).json({
    error: {
      message:
        "Demasiadas solicitudes. Por favor intenta de nuevo más tarde.",
      code: "RATE_LIMIT_EXCEEDED",
      retryAfter: retryAfterSeconds,
    },
  });
};

export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: (req) => !isProd,
  keyGenerator: ipKeyGenerator,
  store: createStore(),
  handler: rateLimitHandler,
});

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skipFailedRequests: false,
  keyGenerator: (req) => req.body?.email || ipKeyGenerator(req),
  store: createStore(),
  handler: rateLimitHandler,
});

export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  keyGenerator: ipKeyGenerator,
  store: createStore(),
  handler: rateLimitHandler,
});

export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: ipKeyGenerator,
  store: createStore(),
  handler: rateLimitHandler,
});
