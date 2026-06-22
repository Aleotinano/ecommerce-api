/**
 * Verificacion de la firma del webhook de WhatsApp (X-Hub-Signature-256).
 *
 * Meta firma el body crudo con HMAC-SHA256 usando el App Secret y lo manda en el
 * header `X-Hub-Signature-256: sha256=<hex>`. Validamos contra el RAW body (no el
 * JSON re-serializado) antes de confiar en el payload. Comparacion en tiempo
 * constante con `timingSafeEqual`.
 *
 * @see https://developers.facebook.com/docs/graph-api/webhooks/getting-started#validate-payloads
 */
import crypto from "node:crypto";

/**
 * @param {object} p
 * @param {Buffer|string} p.rawBody  Body crudo de la request (req.rawBody).
 * @param {string} [p.header]        Valor de X-Hub-Signature-256.
 * @param {string} [p.appSecret]     WHATSAPP_APP_SECRET.
 * @returns {boolean} true si la firma es valida.
 */
export function isValidSignature({ rawBody, header, appSecret }) {
  if (!appSecret || !header || !rawBody) return false;
  if (!header.startsWith("sha256=")) return false;

  const received = header.slice("sha256=".length);

  const expected = crypto
    .createHmac("sha256", appSecret)
    .update(rawBody)
    .digest("hex");

  // timingSafeEqual exige buffers del mismo largo: si difieren, no coinciden.
  const a = Buffer.from(received, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}
