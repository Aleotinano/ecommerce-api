import { randomBytes, createHash } from "node:crypto";

export const EMAIL_VERIFICATION_TTL_MS = 1000 * 60 * 60 * 24;

export function generateEmailVerificationToken() {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS);
  return { token, tokenHash, expiresAt };
}

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Cuánto vive el link de seguimiento de un pedido sin cuenta.
 *
 * No hay columna de vencimiento: se deriva de `Order.createdAt`, que es el dato
 * que ya está. 90 días es holgado para el interés real de alguien en un pedido
 * —que se agota a los pocos días— y acota la ventana en que un link reenviado o
 * copiado en algún lado sigue abriendo datos de una persona.
 */
export const ORDER_TRACKING_TTL_MS = 1000 * 60 * 60 * 24 * 90;

/**
 * La credencial de seguimiento de un pedido: 128 bits de azar.
 *
 * Se guarda SOLO el hash (`Order.trackingTokenHash`); el token en claro se emite
 * una vez, en la respuesta del POST, y después no existe en ningún lado. Con 128
 * bits, adivinarlo no es un ataque que valga la pena escribir: por eso el rate
 * limit de la ruta pública es una guarda de recursos y no la frontera.
 *
 * `base64url` y no hex: 22 caracteres en vez de 32, y sin caracteres que haya que
 * escapar en una URL ni que WhatsApp corte al autolinkear.
 */
export function generateOrderTrackingToken() {
  const token = randomBytes(16).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

/** La fecha a partir de la cual un pedido sigue siendo consultable por token. */
export function orderTrackingCutoff(now = Date.now()) {
  return new Date(now - ORDER_TRACKING_TTL_MS);
}
