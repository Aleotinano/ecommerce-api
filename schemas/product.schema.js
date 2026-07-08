import { z } from "zod";
import { createVariant } from "./variant.schema.js";
import { SUGGESTION_ANGLES } from "./content-suggestion.schema.js";

// Combos: una fila de la whitelist de productos permitidos dentro de un combo.
export const comboOption = z.object({
  allowedProductId: z.coerce
    .number({ invalid_type_error: "El ID de producto debe ser un número" })
    .int("El ID de producto debe ser un número entero")
    .positive("ID de producto inválido"),
  minQty: z.coerce
    .number({ invalid_type_error: "minQty debe ser un número" })
    .int("minQty debe ser un número entero")
    .min(0, "minQty no puede ser negativo")
    .optional()
    .default(0),
  maxQty: z.coerce
    .number({ invalid_type_error: "maxQty debe ser un número" })
    .int("maxQty debe ser un número entero")
    .positive("maxQty debe ser mayor a 0")
    .nullable()
    .optional(),
});

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
  // Solo se usa cuando `variants` viene vacío: crea una variante default
  // (color/size null) para que el producto sea vendible sin variantes reales.
  stock: z.coerce
    .number({ invalid_type_error: "El stock debe ser un número" })
    .int("El stock debe ser un número entero")
    .min(0, "El stock no puede ser negativo")
    .optional(),
  // Combos: producto compuesto de otros productos (ver docs/servicios/dominio/Combos.md).
  isCombo: z
    .boolean({ invalid_type_error: "El valor debe ser booleano" })
    .optional()
    .default(false),
  comboMinItems: z.coerce
    .number({ invalid_type_error: "comboMinItems debe ser un número" })
    .int("comboMinItems debe ser un número entero")
    .positive("comboMinItems debe ser mayor a 0")
    .optional(),
  comboMaxItems: z.coerce
    .number({ invalid_type_error: "comboMaxItems debe ser un número" })
    .int("comboMaxItems debe ser un número entero")
    .positive("comboMaxItems debe ser mayor a 0")
    .optional(),
  comboOptions: z.array(comboOption).optional().default([]),
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
    // Solo aplica si el producto tiene la variante default sin variantes reales
    // (color/size null) creada por `createProduct` sin `variants`; se ignora si no.
    stock: z.coerce
      .number({ invalid_type_error: "El stock debe ser un número" })
      .int("El stock debe ser un número entero")
      .min(0, "El stock no puede ser negativo")
      .optional(),
    // Combos: ver docs/servicios/dominio/Combos.md. `comboOptions` reemplaza la
    // whitelist completa si se envía (no hay merge incremental en v1).
    isCombo: z
      .boolean({ invalid_type_error: "El valor debe ser booleano" })
      .optional(),
    comboMinItems: z.coerce
      .number({ invalid_type_error: "comboMinItems debe ser un número" })
      .int("comboMinItems debe ser un número entero")
      .positive("comboMinItems debe ser mayor a 0")
      .nullable()
      .optional(),
    comboMaxItems: z.coerce
      .number({ invalid_type_error: "comboMaxItems debe ser un número" })
      .int("comboMaxItems debe ser un número entero")
      .positive("comboMaxItems debe ser mayor a 0")
      .nullable()
      .optional(),
    comboOptions: z.array(comboOption).optional(),
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
    // Acepta "1,2,3" (chips de categoría múltiples) o un solo id.
    categoryId: z
      .union([z.string(), z.array(z.string())])
      .transform((value) =>
        (Array.isArray(value) ? value : value.split(","))
          .map((id) => id.trim())
          .filter(Boolean)
          .map(Number)
      )
      .pipe(z.array(z.number().int().positive()))
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
