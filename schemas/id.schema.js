import { z } from "zod";

export const validateId = z.object({
  id: z.coerce.number().int().positive("ID inválido"),
});
