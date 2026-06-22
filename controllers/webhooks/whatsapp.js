/**
 * Webhook de WhatsApp Cloud API.
 *
 * GET  /webhooks/whatsapp -> verificacion del webhook (handshake de Meta).
 * POST /webhooks/whatsapp -> recepcion de mensajes.
 *
 * Reglas clave:
 * - Validamos la firma (X-Hub-Signature-256) contra el RAW body antes de confiar.
 * - Respondemos 200 INMEDIATAMENTE; el procesamiento (resolver tenant + LLM +
 *   envio) va DESPUES, fire-and-forget. Meta reintenta ante cualquier no-200, asi
 *   que un phone_number_id sin match tambien devuelve 200 (se ignora en silencio).
 * - Modulo inactivo si faltan env vars: respondemos 200 sin procesar.
 */
import { DEFAULTS } from "../../config.js";
import { logger } from "../../lib/logger.js";
import { isValidSignature } from "../../services/whatsapp/signature.js";
import {
  extractTextMessages,
  extractIgnoredTypes,
} from "../../schemas/whatsapp.schema.js";
import { WhatsappModel } from "../../services/whatsapp/index.js";

const log = logger.child({ module: "whatsapp:webhook" });

/** El modulo solo opera si tiene con que validar (APP_SECRET) y responder (ACCESS_TOKEN). */
const isConfigured = () =>
  Boolean(DEFAULTS.WHATSAPP.APP_SECRET && DEFAULTS.WHATSAPP.ACCESS_TOKEN);

export class WhatsappWebhookController {
  /**
   * Handshake de verificacion de Meta. Si hub.mode=subscribe y el verify_token
   * coincide con el de env, devolvemos hub.challenge en texto plano.
   */
  static verify(req, res) {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    const expected = DEFAULTS.WHATSAPP.VERIFY_TOKEN;

    if (mode === "subscribe" && expected && token === expected) {
      log.info("webhook verificado");
      return res
        .status(200)
        .type("text/plain")
        .send(String(challenge ?? ""));
    }

    log.warn({ mode }, "verificacion de webhook rechazada");
    return res.sendStatus(403);
  }

  /**
   * Recepcion de mensajes. Valida firma, responde 200 y procesa async.
   */
  static receive(req, res) {
    if (!isConfigured()) {
      log.warn(
        "webhook recibido pero el modulo de WhatsApp no esta configurado",
      );
      return res.sendStatus(200);
    }

    // Firma sobre el raw body: payload no firmado es sospechoso -> 401, sin procesar.
    const valid = isValidSignature({
      rawBody: req.rawBody,
      header: req.get("x-hub-signature-256"),
      appSecret: DEFAULTS.WHATSAPP.APP_SECRET,
    });
    if (!valid) {
      log.warn("firma de webhook invalida");
      return res.sendStatus(401);
    }
    // 200 INMEDIATO: Meta no debe reintentar mientras procesamos.
    res.sendStatus(200);

    // --- Procesamiento DESPUES del 200 (fire-and-forget) ---
    // NOTA(prod): encolar aca (p. ej. BullMQ) en vez de procesar inline.
    try {
      const ignored = extractIgnoredTypes(req.body);
      if (ignored.length) {
        log.info(
          { types: ignored },
          "mensajes no-texto ignorados (v1 solo texto)",
        );
      }

      const messages = extractTextMessages(req.body);
      for (const { phoneNumberId, waId, wamid, text, profileName } of messages) {
        WhatsappModel.processInbound({
          phoneNumberId,
          waId,
          wamid,
          text,
          profileName,
        }).catch((err) =>
          log.error({ err: err.message }, "processInbound rechazo no capturado"),
        );
      }
    } catch (err) {
      log.error({ err: err.message }, "fallo procesando webhook tras el 200");
    }
  }
}
