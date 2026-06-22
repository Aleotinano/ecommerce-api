/**
 * Fachada del canal de WhatsApp: `WhatsappModel`.
 *
 * Orquesta un mensaje entrante de WhatsApp REUSANDO el motor del chatbot web
 * (`ChatModel`): resuelve el tenant por `phone_number_id`, aplica rate-limit por
 * wa_id, recupera el history corto de Redis, llama a ChatModel como un visitante
 * ANONIMO (sin user -> sin getMyOrderStatus, igual que el web anonimo) y envia la
 * respuesta de vuelta por la Graph API. NO reescribe el bot ni las tools.
 *
 * Se invoca DESPUES de responder 200 al webhook (fire-and-forget en esta etapa).
 * Por eso captura sus propios errores: nunca debe propagar (no hay request viva).
 * NOTA(prod): conviene mover este procesamiento a una cola en vez de fire-and-forget.
 */
import { ChatModel } from "../chat/index.js";
import { DEFAULTS } from "../../config.js";
import { logger } from "../../lib/logger.js";
import { MAX_MESSAGE_LENGTH } from "../../schemas/chat.schema.js";
import { resolveTenantByPhoneNumberId } from "./tenant-resolver.js";
import { consumeWaQuota } from "./rate-limit.js";
import { isFirstDelivery } from "./dedup.js";
import { getHistory, appendTurn } from "./history.js";
import { sendTextMessage } from "./graph-api.js";

const log = logger.child({ module: "whatsapp:model" });

export const WhatsappModel = {
  /**
   * Procesa un unico mensaje de texto entrante de punta a punta.
   *
   * @param {object} p
   * @param {string} p.phoneNumberId  Numero de la marca que recibio (del payload).
   * @param {string} p.waId           wa_id del remitente (cliente anonimo).
   * @param {string} p.wamid          id del mensaje en el payload de Meta (dedup).
   * @param {string} p.text           Texto del mensaje.
   * @param {string|null} [p.profileName]  Nombre de perfil del remitente (si vino).
   * @param {Date}   [p.now]
   */
  async processInbound({
    phoneNumberId,
    waId,
    wamid,
    text,
    profileName = null,
    now = new Date(),
  }) {
    try {
      // 1. Tenant por phone_number_id (DB = fuente de verdad). Sin match -> ignorar.
      const tenant = await resolveTenantByPhoneNumberId(phoneNumberId);
      if (!tenant) {
        log.info({ phoneNumberId }, "phone_number_id sin tenant, ignorado");
        return;
      }
      const { tenantId, accessToken } = tenant;

      // 1b. Dedup por wamid: Meta entrega at-least-once y puede redespachar el
      //     mismo mensaje. Sin esto: doble LLM (gasto) + respuesta duplicada.
      //     Va ANTES del rate-limit y del LLM. Sin Redis degrada ABIERTO; con
      //     Redis caido degrada CERRADO (ver dedup.js).
      if (wamid) {
        const fresh = await isFirstDelivery({ tenantId, wamid });
        if (!fresh) {
          log.info({ tenantId, wamid }, "wamid duplicado, descartado");
          return;
        }
      }

      // 2. Rate-limit por remitente (ademas del cost-guard por tenant en ChatModel).
      const allowed = await consumeWaQuota({ tenantId, waId });
      if (!allowed) {
        log.warn({ tenantId, waId }, "wa_id rate-limited, mensaje descartado");
        return;
      }

      // 3. History corto por (tenant + wa_id); acotamos el mensaje como el web.
      const history = await getHistory({ tenantId, waId });
      const message = text.slice(0, MAX_MESSAGE_LENGTH);

      // 4. Motor existente, remitente ANONIMO (sin user). Degrada CERRADO por
      //    cuota igual que el web (consumeChatQuota adentro de ChatModel). El
      //    `channel` da identidad de cliente (wa_id) y habilita createDraftOrder.
      const { reply } = await ChatModel.sendMessage({
        tenantId,
        user: null,
        message,
        history,
        channel: { kind: "whatsapp", waId, contactName: profileName },
        now,
      });

      if (!reply) return;

      // 5. Respuesta saliente por la Graph API. El token sale del resolver:
      //    el de la marca (cifrado en DB) o el global de env como fallback.
      const sent = await sendTextMessage({
        phoneNumberId,
        to: waId,
        text: reply,
        token: accessToken,
        apiVersion: DEFAULTS.WHATSAPP.GRAPH_API_VERSION,
      });

      // 6. Persistimos el turno solo si se envio, para mantener continuidad.
      if (sent) {
        await appendTurn({ tenantId, waId, userMessage: message, assistantReply: reply });
      }
    } catch (err) {
      // Post-200: no hay request viva. Logueamos y tragamos (incluye 429/503 del
      // cost-guard: degrada en silencio para el usuario de WhatsApp).
      log.error({ err: err.message, phoneNumberId }, "fallo procesando mensaje de WhatsApp");
    }
  },
};
