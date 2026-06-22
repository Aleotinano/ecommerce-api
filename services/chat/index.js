/**
 * Fachada del chatbot del storefront: `ChatModel`.
 *
 * Orquesta un mensaje del cliente: verifica cuota (degrada CERRADO), arma el
 * system prompt con la marca del tenant, construye las tools con el tenant/user
 * inyectados server-side y corre el loop agentico. Read-only de punta a punta.
 *
 * STATELESS: el `history` llega del cliente y no se persiste. El contrato
 * ({ tenantId, user, message, history } -> { reply }) queda preparado para sumar
 * persistencia mas adelante (ver TODO) sin cambiar la firma publica.
 */
import { TenantConfigModel } from "../tenant-config.js";
import { runAgent } from "../../lib/llm/agent.js";
import { consumeChatQuota } from "./cost-guard.js";
import { buildToolContext } from "./tools.js";
import { buildSystemPrompt } from "./prompt.js";

/** Trae la config de marca sin cortar el chat si el tenant no tiene una. */
const loadBrandConfig = async (tenantId) => {
  try {
    return await TenantConfigModel.get({ tenantId });
  } catch {
    return null;
  }
};

export const ChatModel = {
  /**
   * Procesa un mensaje del cliente y devuelve la respuesta del asistente.
   *
   * @param {object} p
   * @param {number} p.tenantId  Resuelto por slug (req.tenantId). NUNCA del LLM.
   * @param {object|null} p.user Cliente logueado (req.user) u objeto null si anonimo.
   * @param {string} p.message   Mensaje nuevo del usuario.
   * @param {Array}  [p.history] Historial [{ role, content }] provisto por el cliente.
   * @param {object|null} [p.channel] Canal con identidad de cliente (ej. WhatsApp:
   *   { kind:"whatsapp", waId, contactName }). Habilita tools de pedido del bot.
   * @returns {Promise<{ reply: string }>}
   */
  async sendMessage({
    tenantId,
    user = null,
    message,
    history = [],
    channel = null,
    now = new Date(),
  }) {
    // Degrada CERRADO: si no se puede verificar la cuota, no se llama al LLM.
    await consumeChatQuota({ tenantId, now });

    const config = await loadBrandConfig(tenantId);

    const system = buildSystemPrompt({
      config,
      canCreateOrders: channel?.kind === "whatsapp",
    });
    const { tools, executeTool } = buildToolContext({
      tenantId,
      user,
      config,
      // Enriquecemos el canal con el mensaje actual + historial para que la tool
      // de pedido pueda armar el snapshot de contexto de la orden.
      channel: channel ? { ...channel, message, history } : null,
    });

    const { reply } = await runAgent({
      system,
      history,
      message,
      tools,
      executeTool,
    });

    // TODO(persistencia): aca se podria guardar el turno (tenantId, user?.id,
    // sessionId, message, reply) sin cambiar el contrato del endpoint.
    return { reply };
  },
};
