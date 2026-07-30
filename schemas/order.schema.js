import { z } from "zod";

// READY = "listo para retirar/enviar". Es un paso opcional entre PROCESSING y
// COMPLETED (ver services/order-state.js): un panel viejo que no lo ofrezca
// sigue funcionando igual.
const ORDER_STATUSES = [
  "PENDING",
  "PROCESSING",
  "READY",
  "COMPLETED",
  "CANCELLED",
];
const ORDER_STATUS_LIST = ORDER_STATUSES.join(", ");
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
      message: `El status debe ser uno de: ${ORDER_STATUS_LIST}`,
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

// Vía por la que entra la plata en una fila del libro de cobros. `GATEWAY`
// (MercadoPago) no se acepta por HTTP: esas filas las escribe el webhook, nadie
// las carga a mano.
const MANUAL_CHANNELS = ["CASH", "TRANSFER"];

const paymentChannel = z.enum(MANUAL_CHANNELS, {
  errorMap: () => ({ message: "channel debe ser CASH o TRANSFER" }),
});

const paymentNote = z
  .string()
  .max(500, "La nota no puede superar 500 caracteres")
  .optional();

// `channel` es opcional porque casi siempre se deriva del método de pago de la
// orden; hace falta cuando la orden es MIXED o todavía no tiene método definido
// (el service responde PAYMENT_CHANNEL_REQUIRED si no puede derivarlo).
export const orderConfirmDeposit = z.object({
  note: paymentNote,
  channel: paymentChannel.optional(),
});

// Confirmación manual de que la transferencia llegó (la revisa un asistente,
// no hay verificación automática). `amount` permite declarar cuánto entró
// realmente; sin él se asume lo que la orden todavía debe por transferencia.
export const orderConfirmTransfer = z.object({
  note: paymentNote,
  amount: z.coerce
    .number({ invalid_type_error: "amount debe ser un número" })
    .positive("amount debe ser mayor a 0")
    .optional(),
  // Comprobantes que quien confirma está mirando (ver orderReceiptCreate). Se
  // enlazan a la fila del libro que genera esta confirmación. Sirven tanto para
  // los ya cargados antes como para el que viaja en este mismo request multipart.
  receiptIds: z
    .array(z.coerce.number().int().positive("receiptIds debe traer ids válidos"))
    .optional(),
});

// Comprobante de transferencia adjunto a la orden: el archivo va como multipart
// (campo `receipt`), acá solo viaja la nota opcional. Subirlo NO confirma nada —
// es evidencia; la confirmación la hace una persona mirando la cuenta.
export const orderReceiptCreate = z.object({
  note: paymentNote,
});

// Params de las rutas anidadas de comprobantes. NO se puede reusar `validateId`:
// `validate` pisa `req.params` con lo que devuelve Zod, y como Zod descarta las
// claves que no declara, el `receiptId` se perdería antes de llegar al controller.
export const orderReceiptParams = z.object({
  id: z.coerce.number().int().positive("ID inválido"),
  receiptId: z.coerce.number().int().positive("ID de comprobante inválido"),
});

// Cobro total dado por bueno a mano (mueve paymentStatus a PAID_IN_FULL). Es la
// contraparte manual del webhook de MercadoPago para efectivo/transferencia.
export const orderConfirmPayment = z.object({
  note: paymentNote,
  channel: paymentChannel.optional(),
});

// Alta directa en el libro de cobros: `POST /orders/:id/payments`. Acá `channel`
// SÍ es obligatorio — es un registro manual, no hay nada de dónde derivarlo.
export const orderPaymentCreate = z.object({
  kind: z.enum(["DEPOSIT", "PAYMENT", "REFUND"], {
    errorMap: () => ({ message: "kind debe ser DEPOSIT, PAYMENT o REFUND" }),
  }),
  channel: paymentChannel,
  amount: z.coerce
    .number({ invalid_type_error: "amount debe ser un número" })
    .positive("amount debe ser mayor a 0"),
  note: paymentNote,
});

export const orderQuery = z.object({
  status: z
    .enum(ORDER_STATUSES, {
      errorMap: () => ({
        message: `El status debe ser uno de: ${ORDER_STATUS_LIST}`,
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
