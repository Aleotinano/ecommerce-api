import { z } from "zod";

export const validateId = z.object({
  id: z.coerce
    .number({
      invalid_type_error: "El ID debe ser un número",
    })
    .int("El ID debe ser un número entero")
    .positive("ID inválido"),
});
