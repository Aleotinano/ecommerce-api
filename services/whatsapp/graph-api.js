/**
 * Envio de mensajes salientes via WhatsApp Cloud API (Meta Graph API).
 *
 * POST https://graph.facebook.com/{version}/{phone_number_id}/messages
 * con Authorization: Bearer {access_token}. En dev usamos un unico numero/token
 * desde env; en prod el token saldria por tenant.
 *
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
 */
import { logger } from "../../lib/logger.js";

const log = logger.child({ module: "whatsapp:graph-api" });

const GRAPH_BASE = "https://graph.facebook.com";

/**
 * Envia un mensaje de texto a un destinatario.
 *
 * @param {object} p
 * @param {string} p.phoneNumberId  Numero emisor (de la marca).
 * @param {string} p.to             wa_id del destinatario.
 * @param {string} p.text           Cuerpo del mensaje.
 * @param {string} p.token          Access token (Bearer).
 * @param {string} p.apiVersion     Version del Graph API (ej. "v21.0").
 * @returns {Promise<boolean>} true si Meta acepto el envio.
 */
export async function sendTextMessage({ phoneNumberId, to, text, token, apiVersion }) {
  if (!phoneNumberId || !to || !text || !token) {
    log.warn({ phoneNumberId }, "envio omitido: faltan parametros/token");
    return false;
  }

  const url = `${GRAPH_BASE}/${apiVersion}/${phoneNumberId}/messages`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { body: text },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      log.error({ status: res.status, detail }, "envio a Graph API fallo");
      return false;
    }
    return true;
  } catch (err) {
    log.error({ err: err.message }, "error de red enviando a Graph API");
    return false;
  }
}
