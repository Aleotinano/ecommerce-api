/**
 * Rate limit por remitente (wa_id) para el canal de WhatsApp.
 *
 * Evita que un solo numero abuse del bot. Contador en Redis con INCR + EXPIRE en
 * una ventana corta, scopeado por tenant + wa_id (mirror del patron de
 * services/chat/cost-guard.js). Esto es ADEMAS del cost-guard por tenant
 * (consumeChatQuota), que sigue aplicando dentro de ChatModel.
 *
 * Sin Redis no podemos contar: devolvemos `true` (permitimos). El cost-guard del
 * chat ya degrada CERRADO por tenant, asi que el gasto de LLM sigue protegido.
 */
import { getRedis } from "../../lib/redis.js";
import { tenantNs } from "../../lib/cache.js";
import { logger } from "../../lib/logger.js";

const log = logger.child({ module: "whatsapp:rate-limit" });

/** Maximo de mensajes por wa_id dentro de la ventana. */
const MAX_PER_WINDOW = 20;
/** Ventana en segundos. */
const WINDOW_SECONDS = 60;

const key = (tenantId, waId) =>
  `${tenantNs(tenantId)}:wa:rl:${waId}`;

/**
 * Reserva una unidad de cuota para el wa_id. Devuelve `false` si supero el tope
 * (el caller no procesa el mensaje).
 * @returns {Promise<boolean>} true si se permite, false si esta limitado.
 */
export async function consumeWaQuota({ tenantId, waId }) {
  const redis = getRedis();
  if (!redis) return true;

  try {
    const k = key(tenantId, waId);
    const count = await redis.incr(k);
    if (count === 1) {
      await redis.expire(k, WINDOW_SECONDS);
    }
    return count <= MAX_PER_WINDOW;
  } catch (err) {
    log.warn({ err: err.message, tenantId }, "rate-limit redis fallo, permitiendo");
    return true;
  }
}
