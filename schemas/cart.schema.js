import { z } from "zod";
import { serviceBooking } from "./service.schema.js";

// Body de POST/PATCH /cart/:productId — `variantId` es obligatorio solo si el
// producto es VARIANTE (lo valida el service, no acá: el schema no conoce el tipo
// del producto). Ausente/undefined para UNIDAD/COMBO.
export const cartItemBody = z.object({
  variantId: z.coerce
    .number({ invalid_type_error: "El ID de variante debe ser un número" })
    .int("El ID de variante debe ser un número entero")
    .positive("ID de variante inválido")
    .optional(),
  // Turno: obligatorio si el producto es un SERVICIO, prohibido si no (lo decide
  // `resolveServiceBooking`, que conoce el producto). Solo lo lee `POST`; en `PATCH`
  // (restar 1) no tiene sentido y se ignora.
  service: serviceBooking.optional(),
});
