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

  imageUrl: z
    .string({ invalid_type_error: "La imagen debe ser texto" })
    .url("La URL de la imagen no es válida")
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

    imageUrl: z
      .string({ invalid_type_error: "La imagen debe ser texto" })
      .url("La URL de la imagen no es válida")
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
  // Sin `.refine` de "al menos un campo": el caso vacío (ni body ni imagen) ya lo
  // corta `requireBodyOrImage` en la ruta, y ese refine rechazaba los updates que
  // mandan SOLO una imagen (que viaja en req.files, no en req.body).
  .strip();

export const categoryId = z.object({
  id: z.coerce
    .number({ invalid_type_error: "El ID debe ser un número" })
    .int("El ID debe ser un número entero")
    .positive("El ID de la categoría es inválido"),
});
