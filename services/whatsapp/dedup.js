/**
 * Dedup de entregas de WhatsApp por wamid.
 *
 * WhatsApp Cloud API entrega at-least-once: ante cualquier no-200 (o por su propia
 * logica de reintentos) Meta puede redespachar el MISMO mensaje, identificado por
 * su `wamid`. Sin dedup eso significa doble llamada al LLM (gasto) + respuesta
 * duplicada al cliente. Por eso el dedup va ANTES del rate-limit y del LLM.
 *
 * Estrategia: SET NX + TTL corto en Redis. La primera entrega gana; las repetidas
 * dentro de la ventana se descartan. Scopeado por tenant.
 *
 * Degradacion (alineada con history.js / rate-limit.js):
 * - Sin Redis (CACHE_ENABLED=false): NO hay dedup -> tratamos como primera entrega
 *   (ABIERTO), igual que el resto del canal. El cost-guard por tenant del chat
 *   sigue protegiendo el gasto de LLM.
 * - Con Redis pero error: degrada CERRADO (descartamos). En un canal publico con
 *   costo por mensaje preferimos perder un mensaje ocasional antes que duplicar
 *   cobro y respuesta.
 */
import { getRedis } from "../../lib/redis.js";
import { tenantNs } from "../../lib/cache.js";
import { logger } from "../../lib/logger.js";

const log = logger.child({ module: "whatsapp:dedup" });

/** TTL de la marca de "visto": cubre la ventana de reintentos de Meta sin acumular keys. */
const TTL_SECONDS = 600;

const seenKey = (tenantId, wamid) => `${tenantNs(tenantId)}:wa:seen:${wamid}`;

/**
 * @param {object} p
 * @param {string} p.tenantId
 * @param {string} p.wamid     id del mensaje en el payload de Meta.
 * @returns {Promise<boolean>} true si es la PRIMERA vez que vemos este wamid.
 */
export async function isFirstDelivery({ tenantId, wamid }) {
  const redis = getRedis();
  if (!redis) return true; // sin Redis no hay dedup; degradamos ABIERTO

  try {
    const res = await redis.set(seenKey(tenantId, wamid), "1", "EX", TTL_SECONDS, "NX");
    return res === "OK"; // null si la key ya existia -> duplicado
  } catch (err) {
    log.error({ err: err.message, tenantId, wamid }, "fallo dedup en Redis, degradando cerrado");
    return false;
  }
}
