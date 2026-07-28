import { z } from "zod";

const ORDER_STATUSES = ["PENDING", "PROCESSING", "COMPLETED", "CANCELLED"];
const FULFILLMENT_METHODS = ["DELIVERY", "PICKUP"];
const ORDER_PAYMENT_METHODS = ["CASH", "TRANSFER", "MIXED"];

// Hosts de Google Maps que aceptamos en addressMapsUrl. No hay resolución del
// link (no seguimos redirects ni geocodificamos): solo evitamos que entre
// cualquier URL. `maps.app.goo.gl` es el que genera "Compartir ubicación" en
// Android/iOS, que es como la gente manda su casa en la práctica.
const MAPS_HOSTS = [
  "google.com",
  "www.google.com",
  "maps.google.com",
  "maps.app.goo.gl",
  "goo.gl",
];

// Exportada para schemas/address.schema.js: la libreta de direcciones valida el
// mismo link con la misma whitelist (es la fuente de addressMapsUrl de la orden).
export function isGoogleMapsUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (!MAPS_HOSTS.includes(url.hostname)) return false;

  // google.com y goo.gl sirven cualquier cosa: en esos exigimos el path /maps.
  if (url.hostname === "google.com" || url.hostname === "www.google.com") {
    return url.pathname.startsWith("/maps");
  }
  if (url.hostname === "goo.gl") {
    return url.pathname.startsWith("/maps");
  }

  return true;
}

// Compartido por orderCreate y orderReview: si es DELIVERY hace falta una
// ubicación (texto y/o link de Maps), lat/lng (si vienen) tienen que venir
// juntos, y el pago mixto tiene que traer su desglose de montos.
function checkFulfillmentConsistency(data, ctx) {
  if (
    data.fulfillmentMethod === "DELIVERY" &&
    !data.addressText &&
    !data.addressMapsUrl
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["addressText"],
      message:
        "Cuando fulfillmentMethod es DELIVERY hace falta addressText y/o addressMapsUrl",
    });
  }
  if ((data.addressLat != null) !== (data.addressLng != null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["addressLng"],
      message: "addressLat y addressLng deben enviarse juntos",
    });
  }

  // Montos del pago mixto. Que SUMEN el total no se puede validar acá: el total
  // lo calcula el server desde el carrito (ver OrderModel.create, que tira
  // PAYMENT_AMOUNTS_MISMATCH). Acá solo exigimos que estén y sean coherentes
  // con el método elegido.
  if (data.paymentMethod === "MIXED") {
    for (const key of ["cashAmount", "transferAmount"]) {
      if (data[key] == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} es obligatorio cuando paymentMethod es MIXED`,
        });
      } else if (data[key] <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} debe ser mayor a 0 cuando paymentMethod es MIXED`,
        });
      }
    }
  } else if (data.paymentMethod != null) {
    for (const key of ["cashAmount", "transferAmount"]) {
      if (data[key] != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} solo aplica cuando paymentMethod es MIXED`,
        });
      }
    }
  }
}

const fulfillmentFields = {
  addressText: z
    .string()
    .trim()
    .min(1, "addressText no puede estar vacío")
    .max(300, "addressText no puede superar 300 caracteres")
    .optional(),
  addressLat: z.coerce.number().min(-90).max(90).optional(),
  addressLng: z.coerce.number().min(-180).max(180).optional(),
  addressDetails: z
    .string()
    .trim()
    .max(300, "addressDetails no puede superar 300 caracteres")
    .nullable()
    .optional(),
  addressMapsUrl: z
    .string()
    .trim()
    .max(500, "addressMapsUrl no puede superar 500 caracteres")
    .refine(isGoogleMapsUrl, "addressMapsUrl debe ser un link de Google Maps")
    .nullable()
    .optional(),
  // nullable además de optional: un front que mande `cashAmount: null` al
  // cambiar de MIXED a CASH no debería comerse un 400 (null cuenta como
  // ausente en checkFulfillmentConsistency).
  cashAmount: z.coerce
    .number({ invalid_type_error: "cashAmount debe ser un número" })
    .nonnegative("cashAmount no puede ser negativo")
    .nullable()
    .optional(),
  transferAmount: z.coerce
    .number({ invalid_type_error: "transferAmount debe ser un número" })
    .nonnegative("transferAmount no puede ser negativo")
    .nullable()
    .optional(),
  paymentNote: z
    .string()
    .trim()
    .max(300, "paymentNote no puede superar 300 caracteres")
    .nullable()
    .optional(),

  // Contacto de quien recibe el pedido. Va en `fulfillmentFields` —y no solo en
  // orderCreate— para que la revisión del admin también pueda completarlo: las
  // órdenes viejas nacieron sin teléfono y alguien tiene que poder cargarlo a
  // mano sin salir del panel.
  //
  // Texto libre acá; a E.164 lo lleva `normalizeCustomerPhone` en el service,
  // que necesita la característica del tenant y por eso no puede vivir en Zod.
  contactPhone: z
    .string()
    .trim()
    .max(30, "contactPhone no puede superar 30 caracteres")
    .nullable()
    .optional(),
  contactName: z
    .string()
    .trim()
    .max(100, "contactName no puede superar 100 caracteres")
    .nullable()
    .optional(),
};

// Creación de orden desde el carrito: entrega/retiro + método de pago.
// El total y las líneas los sigue resolviendo el server desde el carrito.
export const orderCreate = z
  .object({
    fulfillmentMethod: z.enum(FULFILLMENT_METHODS, {
      errorMap: () => ({
        message: "fulfillmentMethod debe ser DELIVERY o PICKUP",
      }),
    }),
    paymentMethod: z.enum(ORDER_PAYMENT_METHODS, {
      errorMap: () => ({
        message: "paymentMethod debe ser CASH, TRANSFER o MIXED",
      }),
    }),
    ...fulfillmentFields,
  })
  .superRefine(checkFulfillmentConsistency);

export const orderStatus = z.object({
  status: z.enum(ORDER_STATUSES, {
    errorMap: () => ({
      message: "El status debe ser PENDING, PROCESSING, COMPLETED o CANCELLED",
    }),
  }),
  note: z.string().max(500, "La nota no puede superar 500 caracteres").optional(),
});

// Revisión admin: corrección inline opcional de cantidades, y — sobre todo
// para órdenes BOT, que nacen sin esto — completar/corregir entrega y pago.
// Nunca acepta precio/total (el server los re-resuelve).
export const orderReview = z
  .object({
    items: z
      .array(
        z.object({
          // Identifica la FILA a editar (OrderItem.id), no la variante: una
          // orden puede tener 2 líneas de la misma variante con notas
          // distintas, así que variantId ya no es una clave única por fila.
          id: z.coerce
            .number({ invalid_type_error: "id debe ser un número" })
            .int("id debe ser entero")
            .positive("id inválido"),
          quantity: z.coerce
            .number({ invalid_type_error: "quantity debe ser un número" })
            .int("quantity debe ser entero")
            .positive("quantity debe ser mayor a 0"),
          // Observación libre de la línea (ej. "sin nueces"), distinta de la nota
          // de la orden (`orderStatus.note`, hasta 500 caracteres).
          note: z
            .string()
            .max(150, "La nota de la línea no puede superar 150 caracteres")
            .nullable()
            .optional(),
        })
      )
      .optional(),
    fulfillmentMethod: z
      .enum(FULFILLMENT_METHODS, {
        errorMap: () => ({
          message: "fulfillmentMethod debe ser DELIVERY o PICKUP",
        }),
      })
      .optional(),
    paymentMethod: z
      .enum(ORDER_PAYMENT_METHODS, {
        errorMap: () => ({
          message: "paymentMethod debe ser CASH, TRANSFER o MIXED",
        }),
      })
      .optional(),
    ...fulfillmentFields,
  })
  .superRefine(checkFulfillmentConsistency);

export const orderConfirmDeposit = z.object({
  note: z.string().max(500, "La nota no puede superar 500 caracteres").optional(),
});

// Confirmación manual de que la transferencia llegó (la revisa un asistente,
// no hay verificación automática). Mismo shape que orderConfirmDeposit.
export const orderConfirmTransfer = z.object({
  note: z.string().max(500, "La nota no puede superar 500 caracteres").optional(),
});

export const orderQuery = z.object({
  status: z
    .enum(ORDER_STATUSES, {
      errorMap: () => ({
        message:
          "El status debe ser PENDING, PROCESSING, COMPLETED o CANCELLED",
      }),
    })
    .optional(),
  search: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(100, "El límite máximo es 100")
    .default(10),
  offset: z.coerce.number().int().min(0).default(0),
});
