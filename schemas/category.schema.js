import { z } from "zod";

export const createCategory = z.object({
  name: z
    .string({ required_error: "El nombre es requerido" })
    .min(1, "El nombre no puede estar vacío")
    .max(50, "El nombre es demasiado largo"),

  description: z
    .string()
    .max(400, "La descripción es demasiado larga")
    .optional(),

  icon: z.string().optional(),

  isActive: z
    .boolean({
      invalid_type_error: "El valor debe ser booleano",
    })
    .optional(),
});

export const updateCategory = z.object({
  name: z.string().min(1).max(50).optional(),

  description: z.string().max(400).optional(),

  icon: z.string().optional(),

  isActive: z.boolean().optional(),
});

export const categoryId = z.object({
  id: z.coerce.number().int().positive("ID de la categoría inválido"),
});
