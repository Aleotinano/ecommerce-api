import { createHash } from "node:crypto";
import { getRedis } from "./redis.js";
import { logger } from "./logger.js";

const JITTER_RATIO = 0.1;

function withJitter(ttlSeconds) {
  const jitter = Math.floor(ttlSeconds * JITTER_RATIO * Math.random());
  return ttlSeconds + jitter;
}

export function tenantNs(tenantId) {
  return `t${tenantId}`;
}

export function hashParams(params = {}) {
  const sorted = Object.keys(params)
    .sort()
    .reduce((acc, k) => {
      const v = params[k];
      if (v !== undefined && v !== null && v !== "") acc[k] = v;
      return acc;
    }, {});
  return createHash("sha1")
    .update(JSON.stringify(sorted))
    .digest("hex")
    .slice(0, 12);
}

export async function get(key) {
  const redis = getRedis();
  if (!redis) return null;

  try {
    const raw = await redis.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    logger.warn({ err: err.message, key }, "cache get failed");
    return null;
  }
}

export async function set(key, value, ttlSeconds) {
  const redis = getRedis();
  if (!redis) return;

  try {
    const ttl = withJitter(ttlSeconds);
    await redis.set(key, JSON.stringify(value), "EX", ttl);
    logger.debug({ key, ttl }, "cache set");
  } catch (err) {
    logger.warn({ err: err.message, key }, "cache set failed");
  }
}

export async function del(...keys) {
  const redis = getRedis();
  if (!redis || keys.length === 0) return;

  try {
    await redis.del(...keys);
  } catch (err) {
    logger.warn({ err: err.message, keys }, "cache del failed");
  }
}

export async function delPattern(pattern) {
  const redis = getRedis();
  if (!redis) return;

  try {
    const stream = redis.scanStream({ match: pattern, count: 100 });
    const pipeline = redis.pipeline();
    let count = 0;

    for await (const keys of stream) {
      for (const k of keys) {
        pipeline.del(k);
        count++;
      }
    }

    if (count > 0) await pipeline.exec();
    logger.debug({ pattern, count }, "cache invalidated by pattern");
  } catch (err) {
    logger.warn({ err: err.message, pattern }, "cache delPattern failed");
  }
}

export async function wrap(key, ttlSeconds, loader) {
  const cached = await get(key);
  if (cached !== null) {
    logger.debug({ key }, "cache hit");
    return cached;
  }

  logger.debug({ key }, "cache miss");
  const value = await loader();
  if (value !== undefined && value !== null) {
    await set(key, value, ttlSeconds);
  }
  return value;
}
