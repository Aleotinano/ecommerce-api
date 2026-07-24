import { z } from "zod";

const ORDER_STATUSES = ["PENDING", "PROCESSING", "COMPLETED", "CANCELLED"];
const FULFILLMENT_METHODS = ["DELIVERY", "PICKUP"];
const ORDER_PAYMENT_METHODS = ["CASH", "TRANSFER", "MIXED"];

// Compartido por orderCreate y orderReview: si es DELIVERY hace falta
// addressText, y lat/lng (si vienen) tienen que venir juntos.
function checkFulfillmentConsistency(data, ctx) {
  if (data.fulfillmentMethod === "DELIVERY" && !data.addressText) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["addressText"],
      message: "addressText es obligatorio cuando fulfillmentMethod es DELIVERY",
    });
  }
  if ((data.addressLat != null) !== (data.addressLng != null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["addressLng"],
      message: "addressLat y addressLng deben enviarse juntos",
    });
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
  paymentNote: z
    .string()
    .trim()
    .max(300, "paymentNote no puede superar 300 caracteres")
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
