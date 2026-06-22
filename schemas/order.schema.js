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
        variantId: z.coerce
          .number({ invalid_type_error: "variantId debe ser un número" })
          .int("variantId debe ser entero")
          .positive("variantId inválido"),
        quantity: z.coerce
          .number({ invalid_type_error: "quantity debe ser un número" })
          .int("quantity debe ser entero")
          .positive("quantity debe ser mayor a 0"),
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
