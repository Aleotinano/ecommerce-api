/**
 * Guarda de costo: limita las llamadas reales al LLM por tenant por dia para
 * evitar abuso (no para tarifar fino). Contador en Redis con INCR + EXPIRE al fin
 * del dia. Si Redis no esta disponible, degrada a "sin limite" (no bloquea la
 * feature): la guarda es best-effort, igual que el cache.
 *
 * IMPORTANTE: solo se debe llamar a `consumeLlmQuota` cuando efectivamente se va a
 * invocar el LLM. Un cache/DB hit no consume cuota.
 */
import { getRedis } from "../../lib/redis.js";
import { tenantNs } from "../../lib/cache.js";
import { logger } from "../../lib/logger.js";
import { createError } from "../../helpers/error.js";

/** Tope diario de generaciones con LLM por tenant. Alto: solo frena el abuso. */
export const DAILY_LLM_LIMIT = 15;

const log = logger.child({ module: "content-suggestions:cost-guard" });

const counterKey = (tenantId, date) =>
  `${tenantNs(tenantId)}:content-llm-count:${date.toISOString().slice(0, 10)}`;

/** Segundos hasta el fin del dia UTC (TTL del contador). */
const secondsUntilEndOfDay = (now) => {
  const endOfDay = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0
  );
  return Math.max(1, Math.ceil((endOfDay - now.getTime()) / 1000));
};

/**
 * Reserva una unidad de cuota para una llamada al LLM. Incrementa el contador del
 * dia y lanza 429 si supera el tope. Best-effort: si Redis falla, deja pasar.
 */
export const consumeLlmQuota = async ({ tenantId, now = new Date() }) => {
  const redis = getRedis();
  if (!redis) return;

  try {
    const key = counterKey(tenantId, now);
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, secondsUntilEndOfDay(now));
    }

    if (count > DAILY_LLM_LIMIT) {
      throw createError(
        "Limite diario de generaciones alcanzado. Proba de nuevo manana.",
        "LLM_DAILY_LIMIT",
        429
      );
    }
  } catch (err) {
    // Re-lanzar el limite; tragar cualquier otro fallo de Redis (degradar abierto).
    if (err.code === "LLM_DAILY_LIMIT") throw err;
    log.warn({ err: err.message, tenantId }, "cost-guard incr fallo, sin limite");
  }
};
