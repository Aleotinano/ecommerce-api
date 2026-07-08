import { z } from "zod";

const ORDER_STATUSES = ["PENDING", "PROCESSING", "COMPLETED", "CANCELLED"];

export const orderStatus = z.object({
  status: z.enum(ORDER_STATUSES, {
    errorMap: () => ({
      message: "El status debe ser PENDING, PROCESSING, COMPLETED o CANCELLED",
    }),
  }),
  note: z.string().max(500, "La nota no puede superar 500 caracteres").optional(),
});

// Revisión admin: corrección inline opcional de cantidades. Nunca acepta
// precio/total (el server los re-resuelve).
export const orderReview = z.object({
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
});

export const orderConfirmDeposit = z.object({
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
