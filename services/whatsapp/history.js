/**
 * History corto de conversacion por (tenant + wa_id) en Redis.
 *
 * WhatsApp no manda el historial en cada webhook (a diferencia del canal web,
 * donde el cliente lo envia). Para dar continuidad mantenemos los ultimos N
 * mensajes con TTL corto, scopeado por tenant. Es el unico estado nuevo de esta
 * etapa; se mantiene minimo. Si Redis no esta, degradamos a sin-historial (el
 * bot responde igual, sin continuidad).
 *
 * Formato [{ role, content }] compatible con `runAgent` / ChatModel.
 */
import { getRedis } from "../../lib/redis.js";
import { tenantNs } from "../../lib/cache.js";
import { logger } from "../../lib/logger.js";

const log = logger.child({ module: "whatsapp:history" });

/** Maximo de mensajes guardados (N turnos = 2N mensajes). */
const MAX_MESSAGES = 10;
/** TTL del historial (1h). */
const TTL_SECONDS = 3600;

const historyKey = (tenantId, waId) =>
  `${tenantNs(tenantId)}:wa:hist:${waId}`;

/**
 * Devuelve el historial guardado (mas viejo -> mas nuevo). [] si no hay o Redis cae.
 * @returns {Promise<Array<{ role: "user"|"assistant", content: string }>>}
 */
export async function getHistory({ tenantId, waId }) {
  const redis = getRedis();
  if (!redis) return [];

  try {
    const raw = await redis.get(historyKey(tenantId, waId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    log.warn({ err: err.message, tenantId }, "no se pudo leer history");
    return [];
  }
}

/**
 * Agrega el turno (mensaje del usuario + respuesta del bot) al historial,
 * recortando a los ultimos MAX_MESSAGES y refrescando el TTL. No-op si no hay Redis.
 */
export async function appendTurn({ tenantId, waId, userMessage, assistantReply }) {
  const redis = getRedis();
  if (!redis) return;

  try {
    const prev = await getHistory({ tenantId, waId });
    const next = [
      ...prev,
      { role: "user", content: userMessage },
      { role: "assistant", content: assistantReply },
    ].slice(-MAX_MESSAGES);

    await redis.set(
      historyKey(tenantId, waId),
      JSON.stringify(next),
      "EX",
      TTL_SECONDS
    );
  } catch (err) {
    log.warn({ err: err.message, tenantId }, "no se pudo guardar history");
  }
}
