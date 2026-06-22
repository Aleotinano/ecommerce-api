import { z } from "zod";

/**
 * Parseo defensivo del payload entrante de WhatsApp Cloud API.
 *
 * El webhook entrega:  entry[].changes[].value, donde `value.metadata` trae el
 * `phone_number_id` (el numero de la MARCA que recibe) y `value.messages[]` los
 * mensajes del cliente. Solo manejamos mensajes de TEXTO en v1; el resto se
 * ignora (lo filtra `extractTextMessages`).
 *
 * El payload es input no confiable (aunque validamos la firma): usamos un schema
 * laxo con passthrough y extraemos solo lo que necesitamos, sin romper si llega
 * una estructura inesperada (status updates, reactions, etc.).
 *
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
 */
const whatsappWebhookBody = z
  .object({
    object: z.string().optional(),
    entry: z.array(z.any()).optional(),
  })
  .passthrough();

/**
 * Aplana el payload a una lista de mensajes de texto accionables.
 *
 * @param {unknown} payload  req.body crudo del webhook.
 * @returns {Array<{ phoneNumberId: string, waId: string, text: string, wamid: string, profileName: string|null }>}
 *   Una entrada por cada mensaje de texto. Vacio si no hay nada que procesar.
 */
export function extractTextMessages(payload) {
  const parsed = whatsappWebhookBody.safeParse(payload);
  if (!parsed.success) return [];

  const out = [];
  for (const entry of parsed.data.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      // `value.contacts[]` trae el nombre de perfil del remitente, mapeado por
      // wa_id. Lo usamos como contactName en las ordenes que crea el bot.
      const nameByWaId = new Map();
      for (const c of value?.contacts ?? []) {
        const name = c?.profile?.name;
        if (c?.wa_id && typeof name === "string" && name.trim()) {
          nameByWaId.set(c.wa_id, name.trim());
        }
      }

      for (const msg of value?.messages ?? []) {
        // Solo texto en v1; el caller loguea e ignora los demas tipos.
        if (msg?.type !== "text") continue;
        const text = msg?.text?.body?.trim();
        const waId = msg?.from;
        if (!text || !waId) continue;

        out.push({
          phoneNumberId,
          waId,
          text,
          // wamid: id del mensaje en el payload de Meta. Lo usamos para dedup
          // (Meta entrega at-least-once y puede redespachar el mismo mensaje).
          wamid: msg?.id ?? null,
          profileName: nameByWaId.get(waId) ?? null,
        });
      }
    }
  }
  return out;
}

/**
 * Tipos de mensaje no-texto presentes en el payload (para logueo informativo).
 * @param {unknown} payload
 * @returns {string[]} tipos ignorados (ej. ["image", "audio"]).
 */
export function extractIgnoredTypes(payload) {
  const parsed = whatsappWebhookBody.safeParse(payload);
  if (!parsed.success) return [];

  const types = [];
  for (const entry of parsed.data.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const msg of change?.value?.messages ?? []) {
        if (msg?.type && msg.type !== "text") types.push(msg.type);
      }
    }
  }
  return types;
}
