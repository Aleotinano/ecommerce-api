import { z } from "zod";
import { createVariant } from "./variant.schema.js";
import { SUGGESTION_ANGLES } from "./content-suggestion.schema.js";

export const createProduct = z.object({
  name: z
    .string({
      required_error: "El nombre es requerido",
      invalid_type_error: "El nombre debe ser texto",
    })
    .min(1, "El nombre no puede estar vacío")
    .max(100, "El nombre es demasiado largo")
    .trim(),
  description: z
    .string({ invalid_type_error: "La descripción debe ser texto" })
    .max(400, "La descripción es demasiado larga")
    .trim()
    .nullable()
    .optional(),
  categoryId: z.coerce
    .number({ invalid_type_error: "El ID de categoría debe ser un número" })
    .int("El ID de categoría debe ser un número entero")
    .positive("El ID de categoría es inválido")
    .nullable()
    .optional(),
  price: z.coerce
    .number({
      required_error: "El precio es requerido",
      invalid_type_error: "El precio debe ser un número",
    })
    .positive("El precio debe ser mayor a 0"),
  img: z
    .string({ invalid_type_error: "La imagen debe ser texto" })
    .url("La URL de la imagen no es válida")
    .nullable()
    .optional(),
  isActive: z
    .boolean({ invalid_type_error: "El valor debe ser booleano" })
    .optional(),
  variants: z.array(createVariant).default([]),
});

export const updateProduct = z
  .object({
    name: z
      .string({ invalid_type_error: "El nombre debe ser texto" })
      .min(1, "El nombre no puede estar vacío")
      .max(100, "El nombre es demasiado largo")
      .trim()
      .optional(),
    description: z
      .string({ invalid_type_error: "La descripción debe ser texto" })
      .max(400, "La descripción es demasiado larga")
      .trim()
      .nullable()
      .optional(),
    categoryId: z.coerce
      .number({ invalid_type_error: "El ID de categoría debe ser un número" })
      .int("El ID de categoría debe ser un número entero")
      .positive("El ID de categoría es inválido")
      .nullable()
      .optional(),
    price: z.coerce
      .number({ invalid_type_error: "El precio debe ser un número" })
      .positive("El precio debe ser mayor a 0")
      .optional(),
    img: z
      .string({ invalid_type_error: "La imagen debe ser texto" })
      .url("La URL de la imagen no es válida")
      .nullable()
      .optional(),
    isActive: z
      .boolean({ invalid_type_error: "El valor debe ser booleano" })
      .optional(),
  })
  // Sin `.refine` de "al menos un campo": el caso vacío (ni body ni imagen) ya lo
  // corta `requireBodyOrImage` en la ruta, y ese refine rechazaba los updates que
  // mandan SOLO una imagen (que viaja en req.files, no en req.body).
  .strip();

export const assignProductCategory = z.object({
  categoryId: z.coerce
    .number({ invalid_type_error: "El ID de categoría debe ser un número" })
    .int("El ID de categoría debe ser un número entero")
    .positive("El ID de categoría es inválido")
    .nullable(),
});

export const productId = z.object({
  id: z.coerce
    .number({ invalid_type_error: "El ID debe ser un número" })
    .int("El ID debe ser un número entero")
    .positive("ID de producto inválido"),
});

export const productQuery = z
  .object({
    name: z.string().optional(),
    categoryId: z.coerce
      .number({ invalid_type_error: "El ID de categoría debe ser un número" })
      .int()
      .positive()
      .optional(),
    variantColor: z.string().optional(),
    variantSize: z.string().optional(),
    // Destacados por ángulo de marketing (Page Builder → OfertContainer). Reusa el
    // mismo enum que Sugerencias; la resolución reusa ANGLE_PREDICATES (fuente única).
    angle: z.enum(SUGGESTION_ANGLES).optional(),
    minPrice: z.coerce
      .number({ invalid_type_error: "El precio mínimo debe ser un número" })
      .positive("El precio mínimo debe ser mayor a 0")
      .optional(),
    maxPrice: z.coerce
      .number({ invalid_type_error: "El precio máximo debe ser un número" })
      .positive("El precio máximo debe ser mayor a 0")
      .optional(),
    limit: z.coerce
      .number()
      .int()
      .positive()
      .max(100, "El límite máximo es 100")
      .default(10),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine(
    (data) =>
      data.minPrice === undefined ||
      data.maxPrice === undefined ||
      data.minPrice <= data.maxPrice,
    {
      message: "El precio mínimo no puede ser mayor al máximo",
      path: ["maxPrice"],
    }
  );
