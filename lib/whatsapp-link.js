/**
 * Deep-link "click to chat" de WhatsApp para mandar un pedido al negocio.
 *
 * Ojo con la confusión de nombres: esto NO es el bot (`services/whatsapp/`, que
 * habla con la Graph API de Meta para responder mensajes entrantes). Acá no hay
 * red ni DB: se arma una URL `wa.me` con el pedido ya redactado y el mensaje lo
 * termina enviando el cliente desde SU propio WhatsApp. Por eso no hacen falta
 * plantillas aprobadas por Meta ni token del tenant.
 *
 * Módulo puro, sin efectos: mismo espíritu que `buildOrderStatusEmail` en
 * lib/mailer.js.
 */

import { normalizeCountryCode, normalizeCustomerPhone } from "./phone.js";

// wa.me quiere el número en formato internacional, solo dígitos: sin "+", sin
// espacios, sin guiones ni paréntesis. Un teléfono argentino completo ronda los
// 12-13 dígitos; el rango E.164 real va de 8 a 15.
const MAX_PHONE_DIGITS = 15;

// A partir de cuántos dígitos, después del código de país, damos por hecho que
// el número YA venía en internacional. Mismo criterio que lib/phone.js.
const MIN_INTERNATIONAL_DIGITS = 9;

/**
 * Normaliza el teléfono DEL NEGOCIO (texto libre que el admin carga en
 * `TenantConfig.socialWhatsapp` / `contactPhone`) al formato que acepta wa.me.
 *
 * Antes esto solo sacaba los no-dígitos y validaba el largo, y eso alcanzaba
 * mientras el admin escribiera el número completo con `+54`. Cuando no lo hacía
 * —"(011) 4555-1234", o directamente "2646064142"— el resultado pasaba la
 * validación y salía un `wa.me` roto: un link que existe, no da error y no le
 * llega a nadie. El caso del 0 nacional era el peor, porque el número se ve
 * bien escrito.
 *
 * Ahora, si no viene en internacional, se intenta reconstruir con los prefijos
 * del tenant (los mismos de `customerPhone*`) y se devuelve null si no se puede.
 * Un número que YA venía en internacional se respeta tal cual: si el admin puso
 * el país, sabe lo que escribió —puede ser una línea fija sin el 9 de móvil— y
 * no somos nadie para agregarle dígitos.
 *
 * @param {string|null|undefined} raw ej. "+54 9 11 5555-1234"
 * @param {object} [opts]
 * @param {string} [opts.country="54"] código de país del tenant
 * @param {string|null} [opts.area]    característica por defecto del tenant
 * @returns {string|null} ej. "5491155551234", o null si no es usable
 */
export function normalizeWaPhone(raw, opts = {}) {
  if (typeof raw !== "string") return null;

  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;

  const country = normalizeCountryCode(opts.country) ?? "54";

  if (
    digits.startsWith(country) &&
    digits.length >= country.length + MIN_INTERNATIONAL_DIGITS
  ) {
    return digits.length <= MAX_PHONE_DIGITS ? digits : null;
  }

  return normalizeCustomerPhone(digits, { country, area: opts.area ?? null });
}

function formatMoney(amount, currency = "ARS") {
  const value = Number(amount) || 0;
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: currency || "ARS",
      // Sin decimales cuando el monto es redondo (el caso normal): "$ 29.980"
      // se lee mejor que "$ 29.980,00" en un chat.
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    // Currency inválida en TenantConfig: no vale la pena romper el pedido.
    return `$${value}`;
  }
}

const FULFILLMENT_LABELS = {
  DELIVERY: "Envío a domicilio",
  PICKUP: "Retiro en el local",
};

const PAYMENT_LABELS = {
  CASH: "Efectivo",
  TRANSFER: "Transferencia",
  MIXED: "Mixto",
};

/**
 * Link de Maps a mostrar: el que pegó el cliente o, si solo mandó coordenadas
 * (picker de mapa en el front), uno derivado. El derivado no se persiste.
 */
function mapsLinkFor(order) {
  if (order.addressMapsUrl) return order.addressMapsUrl;
  if (order.addressLat != null && order.addressLng != null) {
    return `https://maps.google.com/?q=${order.addressLat},${order.addressLng}`;
  }
  return null;
}

// Una línea del pedido. Los combos traen sus componentes en `childItems` (ver
// services/orders.js): se listan como sub-línea del padre, igual que `comboOf`
// en controllers/orders.js.
function itemLines(item, currency) {
  const name = item.product?.name ?? item.variant?.sku ?? "Producto";
  const subtotal = formatMoney(item.price * item.quantity, currency);
  const lines = [`• ${item.quantity}x ${name} — ${subtotal}`];

  if (item.childItems?.length) {
    const parts = item.childItems.map(
      (child) =>
        `${child.quantity}x ${child.product?.name ?? child.variant?.sku ?? "?"}`
    );
    lines.push(`   ↳ ${parts.join(", ")}`);
  }

  if (item.note) {
    lines.push(`   (${item.note})`);
  }

  return lines;
}

function paymentLine(order, currency) {
  const label = PAYMENT_LABELS[order.paymentMethod] ?? order.paymentMethod;

  if (
    order.paymentMethod === "MIXED" &&
    order.cashAmount != null &&
    order.transferAmount != null
  ) {
    return `Pago: ${label} — ${formatMoney(order.cashAmount, currency)} efectivo + ${formatMoney(order.transferAmount, currency)} transferencia`;
  }

  return `Pago: ${label}`;
}

/**
 * Texto del pedido, listo para pre-cargar en WhatsApp.
 *
 * @param {object} p
 * @param {object} p.order  orden con `orderItems` (y sus `childItems`) incluidos
 * @param {object} [p.config] TenantConfig (solo se usa `currency`)
 * @returns {string}
 */
export function buildOrderWhatsappMessage({ order, config = {} }) {
  const currency = config.currency ?? "ARS";
  const lines = [`Hola! Te dejo mi pedido #${order.id}`, ""];

  for (const item of order.orderItems ?? []) {
    lines.push(...itemLines(item, currency));
  }

  lines.push("", `Total: ${formatMoney(order.total, currency)}`, "");
  lines.push(paymentLine(order, currency));

  if (order.paymentNote) {
    lines.push(`Nota de pago: ${order.paymentNote}`);
  }

  if (order.fulfillmentMethod) {
    lines.push(
      `Entrega: ${FULFILLMENT_LABELS[order.fulfillmentMethod] ?? order.fulfillmentMethod}`
    );
  }

  if (order.fulfillmentMethod === "DELIVERY") {
    if (order.addressText) lines.push(`Dirección: ${order.addressText}`);

    const maps = mapsLinkFor(order);
    if (maps) lines.push(`Mapa: ${maps}`);

    if (order.addressDetails) lines.push(`Detalles: ${order.addressDetails}`);
  }

  return lines.join("\n");
}

/**
 * Deep-link completo para que el cliente mande el pedido al negocio.
 *
 * El número sale de `TenantConfig.socialWhatsapp` con fallback a `contactPhone`
 * (ambos son texto libre del branding). Si el tenant no tiene ninguno usable
 * devuelve null: el checkout no depende de esto, simplemente no hay link.
 *
 * @param {object} p
 * @param {object} p.order
 * @param {object} [p.config] TenantConfig
 * @returns {{ url: string, message: string, phone: string }|null}
 */
export function buildOrderWhatsappLink({ order, config = {} }) {
  // Los prefijos del tenant sirven para reparar un número del negocio cargado
  // sin código de país. Son los mismos que se usan con el teléfono del cliente:
  // un tenant opera en una sola región.
  const prefixes = {
    country: config.customerPhoneCountry ?? "54",
    area: config.customerPhoneArea ?? null,
  };

  const phone =
    normalizeWaPhone(config.socialWhatsapp, prefixes) ??
    normalizeWaPhone(config.contactPhone, prefixes);

  if (!phone) return null;

  const message = buildOrderWhatsappMessage({ order, config });

  return {
    url: `https://wa.me/${phone}?text=${encodeURIComponent(message)}`,
    message,
    phone,
  };
}
