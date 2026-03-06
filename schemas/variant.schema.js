import { z } from "zod";

export const variantId = z.object({
  variantId: z.coerce
    .number({ invalid_type_error: "El ID debe ser un numero" })
    .int("El ID debe ser un numero entero")
    .positive("ID de variante invalido"),
});
