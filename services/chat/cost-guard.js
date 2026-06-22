/**
 * Guarda de costo del chatbot publico: limita los mensajes por tenant por dia
 * para evitar abuso de un endpoint anonimo. Contador en Redis con INCR + EXPIRE
 * al fin del dia UTC.
 *
 * IMPORTANTE: a diferencia de content-suggestions/cost-guard.js (que degrada
 * ABIERTO porque es una feature de admin de bajo volumen), este bot es PUBLICO y
 * anonimo, asi que DEGRADA CERRADO: si Redis no esta disponible y no podemos
 * verificar la cuota, NO llamamos al LLM (devolvemos 503). No dejamos la API key
 * expuesta a abuso si Redis se cae.
 */
import { getRedis } from "../../lib/redis.js";
import { tenantNs } from "../../lib/cache.js";
import { logger } from "../../lib/logger.js";
import { createError } from "../../helpers/error.js";
import { DEFAULTS } from "../../config.js";

/** Tope diario de mensajes por tenant (configurable por env CHAT_DAILY_LIMIT). */
export const DAILY_CHAT_LIMIT = DEFAULTS.CHAT.DAILY_LIMIT;

const log = logger.child({ module: "chat:cost-guard" });

const counterKey = (tenantId, date) =>
  `${tenantNs(tenantId)}:chat-count:${date.toISOString().slice(0, 10)}`;

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
 * Reserva una unidad de cuota para un mensaje del chat. Incrementa el contador
 * del dia y lanza 429 si supera el tope. DEGRADA CERRADO: si Redis no esta o
 * falla, lanza 503 (no se llama al LLM).
 */
export const consumeChatQuota = async ({ tenantId, now = new Date() }) => {
  const redis = getRedis();
  if (!redis) {
    throw createError(
      "El asistente no esta disponible en este momento. Proba de nuevo en unos minutos.",
      "CHAT_UNAVAILABLE",
      503
    );
  }

  let count;
  try {
    const key = counterKey(tenantId, now);
    count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, secondsUntilEndOfDay(now));
    }
  } catch (err) {
    // No pudimos verificar la cuota -> no gastamos API key (degradar cerrado).
    log.error({ err: err.message, tenantId }, "cost-guard redis fallo, cerrando");
    throw createError(
      "El asistente no esta disponible en este momento. Proba de nuevo en unos minutos.",
      "CHAT_UNAVAILABLE",
      503
    );
  }

  if (count > DAILY_CHAT_LIMIT) {
    throw createError(
      "El asistente recibio muchas consultas hoy. Proba de nuevo manana.",
      "CHAT_DAILY_LIMIT",
      429
    );
  }
};
