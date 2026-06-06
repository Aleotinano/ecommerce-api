import { z } from "zod";

export const createCategory = z.object({
  name: z
    .string({ required_error: "El nombre es requerido" })
    .min(1, "El nombre no puede estar vacío")
    .max(50, "El nombre es demasiado largo")
    .trim(),

  description: z
    .string({ invalid_type_error: "La descripción debe ser texto" })
    .max(400, "La descripción es demasiado larga")
    .trim()
    .optional(),

  icon: z
    .string({ invalid_type_error: "El icono debe ser texto" })
    .min(1, "El icono no puede estar vacío")
    .nullable()
    .optional(),

  isActive: z
    .boolean({ invalid_type_error: "El valor debe ser booleano" })
    .optional(),

  parentId: z.coerce
    .number({ invalid_type_error: "El ID debe ser un número" })
    .int("El ID debe ser un número entero")
    .positive("El ID de la categoría padre es inválido")
    .nullable()
    .optional(),
});

export const updateCategory = z
  .object({
    name: z
      .string({ invalid_type_error: "El nombre debe ser texto" })
      .min(1, "El nombre no puede estar vacío")
      .max(50, "El nombre es demasiado largo")
      .trim()
      .optional(),

    description: z
      .string({ invalid_type_error: "La descripción debe ser texto" })
      .max(400, "La descripción es demasiado larga")
      .trim()
      .optional(),

    icon: z
      .string({ invalid_type_error: "El icono debe ser texto" })
      .min(1, "El icono no puede estar vacío")
      .nullable()
      .optional(),

    isActive: z
      .boolean({ invalid_type_error: "El valor debe ser booleano" })
      .optional(),

    parentId: z.coerce
      .number({ invalid_type_error: "El ID debe ser un número" })
      .int("El ID debe ser un número entero")
      .positive("El ID de la categoría padre es inválido")
      .nullable()
      .optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "No hay cambios para actualizar",
  });

export const categoryId = z.object({
  id: z.coerce
    .number({ invalid_type_error: "El ID debe ser un número" })
    .int("El ID debe ser un número entero")
    .positive("El ID de la categoría es inválido"),
});
