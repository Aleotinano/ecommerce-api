import { createError } from "./error.js";

/**
 * Turno de una línea de SERVICIO: qué día, a qué hora y para quién.
 *
 * Puro y sin DB, como `helpers/price.js`: acá vive la única definición de "¿este
 * turno es válido para este servicio?", y la usan el carrito (al agregar), el pedido
 * (al pasar el carrito a orden, y en el mostrador) y la revisión del admin. Ver
 * docs/servicios/dominio/Servicios.md.
 *
 * Forma pública (request y respuestas): `{ date: "YYYY-MM-DD", time: "HH:MM",
 * recipientName: string | null }`. Forma en DB: las columnas `serviceDate`
 * (`@db.Date`), `serviceTime` y `serviceRecipientName` de `CartItem`/`OrderItem`.
 */

/**
 * Tipos cuyo precio vive en `ProductVariant`: PRODUCTO y SERVICIO. Un servicio se
 * vende igual que un producto —"baño perro chico / mediano / grande" son variantes—
 * y lo que cambia es que no tiene stock y que su línea lleva un turno.
 */
export const VARIANT_PRODUCT_TYPES = ["PRODUCTO", "SERVICIO"];

export const usesVariants = (type) => VARIANT_PRODUCT_TYPES.includes(type);

export const isService = (product) => product?.type === "SERVICIO";

// `YYYY-MM-DD` como Date a medianoche UTC: es lo que Prisma espera para una columna
// `@db.Date`, y lo que devuelve al leerla. Nunca se interpreta en la zona del server.
const toDbDate = (isoDate) => new Date(`${isoDate}T00:00:00.000Z`);

const toIsoDate = (value) =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

/**
 * "Hoy" como `YYYY-MM-DD` en el día LOCAL del server — mismo criterio que
 * `dayBoundary` (schemas/date.schema.js): un día calendario se ancla al día local, no
 * a UTC. Comparar contra el día UTC le rechazaría a un local en UTC−3 un turno para
 * hoy pedido después de las 21 hs.
 */
const localToday = (now) => {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/**
 * Valida el turno pedido para una línea contra el producto y devuelve las columnas a
 * persistir. Para un producto que no es SERVICIO devuelve todo en null (y rechaza que
 * le manden un turno: un turno en una torta es un error del front, no un dato).
 *
 * @param {object} product  el `Product` (con `type` y `serviceRecipient`)
 * @param {{ date?: string, time?: string, recipientName?: string|null }|null|undefined} service
 * @param {object}  [opts]
 * @param {boolean} [opts.rejectPast=false] rechaza fechas pasadas. Solo lo pide el
 *   carrito: el mostrador puede estar registrando un turno que ya se hizo, y la
 *   revisión de un pedido viejo no puede trabarse porque el día ya pasó.
 * @param {Date} [opts.now]
 */
export function resolveServiceBooking(product, service, { rejectPast = false, now = new Date() } = {}) {
  const empty = { serviceDate: null, serviceTime: null, serviceRecipientName: null };

  if (!isService(product)) {
    if (service != null) {
      const error = createError(
        "Solo los servicios llevan día y horario",
        "SERVICE_BOOKING_NOT_ALLOWED",
        400
      );
      error.details = { productId: product?.id ?? null };
      throw error;
    }
    return empty;
  }

  if (!service?.date || !service?.time) {
    const error = createError(
      "Elegí el día y el horario del servicio",
      "SERVICE_BOOKING_REQUIRED",
      400
    );
    error.details = { productId: product.id };
    throw error;
  }

  // Comparación de strings: `YYYY-MM-DD` ordena igual que las fechas que representa.
  if (rejectPast && service.date < localToday(now)) {
    const error = createError(
      "La fecha del servicio ya pasó",
      "SERVICE_DATE_IN_PAST",
      400
    );
    error.details = { productId: product.id, date: service.date };
    throw error;
  }

  const recipientName =
    typeof service.recipientName === "string" && service.recipientName.trim()
      ? service.recipientName.trim()
      : null;

  // Sin `serviceRecipient` cargado se trata como DIRECTO: es lo que era todo
  // servicio antes de que alguien decidiera lo contrario, y no pide nada de más.
  const mode = product.serviceRecipient ?? "DIRECTO";

  if (mode === "TERCERO" && !recipientName) {
    const error = createError(
      product.serviceRecipientLabel
        ? `Falta completar: ${product.serviceRecipientLabel}`
        : "Indicá para quién es el servicio",
      "SERVICE_RECIPIENT_REQUIRED",
      400
    );
    error.details = { productId: product.id };
    throw error;
  }

  if (mode === "DIRECTO" && recipientName) {
    const error = createError(
      "Este servicio es para quien lo contrata: no lleva destinatario",
      "SERVICE_RECIPIENT_NOT_ALLOWED",
      400
    );
    error.details = { productId: product.id };
    throw error;
  }

  return {
    serviceDate: toDbDate(service.date),
    serviceTime: service.time,
    serviceRecipientName: recipientName,
  };
}

/**
 * Turno de una fila de `CartItem`/`OrderItem` en la forma pública, o `null` si la
 * línea no es de un servicio. Es también la forma que `priceItems` vuelve a recibir
 * cuando el carrito pasa a orden o el admin revisa el pedido.
 */
export function serviceBookingOf(row) {
  if (!row?.serviceDate) return null;
  return {
    date: toIsoDate(row.serviceDate),
    time: row.serviceTime,
    recipientName: row.serviceRecipientName ?? null,
  };
}
