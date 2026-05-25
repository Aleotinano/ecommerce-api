import Redis from "ioredis";
import { DEFAULTS } from "../config.js";
import { logger } from "./logger.js";

let client = null;

export function getRedis() {
  if (!DEFAULTS.CACHE_ENABLED) {
    logger.debug("cache disabled");
    return null;
  }
  if (client) return client;

  logger.info("initializing redis connection");

  const redisConfig = DEFAULTS.REDIS_URL
    ? { url: DEFAULTS.REDIS_URL }
    : { host: "localhost", port: 6379 };

  logger.debug({ config: redisConfig }, "redis config");

  client = new Redis({
    ...redisConfig,
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: true,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 2000);
      logger.warn({ attempt: times, delayMs: delay }, "redis reconnect");
      return delay;
    },
  });

  client.connect().catch((err) =>
    logger.warn({ error: err.message }, "redis initial connection failed, will retry")
  );

  client.on("connect", () => logger.info("redis connected"));
  client.on("ready", () => logger.info("redis ready"));
  client.on("error", (err) => logger.error({ err: err.message }, "redis error"));
  client.on("end", () => logger.warn("redis connection closed"));

  return client;
}

export async function closeRedis() {
  if (client) {
    await client.quit().catch(() => {});
    client = null;
  }
}
