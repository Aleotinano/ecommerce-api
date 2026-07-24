import { z } from "zod";

const promoTier = z.object({
  minQty: z.coerce
    .number({
      required_error: "La cantidad mínima es requerida",
      invalid_type_error: "La cantidad mínima debe ser un número",
    })
    .int("La cantidad mínima debe ser un número entero")
    .positive("La cantidad mínima debe ser mayor a 0"),

  discountPercentage: z.coerce
    .number({
      required_error: "El porcentaje de descuento es requerido",
      invalid_type_error: "El porcentaje de descuento debe ser un número",
    })
    .gt(0, "El porcentaje de descuento debe ser mayor a 0")
    .lt(100, "El porcentaje de descuento debe ser menor a 100"),
});

const productIdsField = z
  .array(
    z.coerce
      .number({ invalid_type_error: "El ID de producto debe ser un número" })
      .int("El ID de producto debe ser un número entero")
      .positive("ID de producto inválido")
  )
  .min(1, "Debés vincular al menos un producto");

export const createPromo = z.object({
  name: z
    .string({ required_error: "El nombre es requerido" })
    .min(1, "El nombre no puede estar vacío")
    .max(100, "El nombre es demasiado largo")
    .trim(),

  description: z
    .string({ invalid_type_error: "La descripción debe ser texto" })
    .max(400, "La descripción es demasiado larga")
    .trim()
    .nullable()
    .optional(),

  isActive: z
    .boolean({ invalid_type_error: "El valor debe ser booleano" })
    .optional(),

  tiers: z.array(promoTier).min(1, "Debés definir al menos un escalón de descuento"),

  productIds: productIdsField,
});

export const updatePromo = z
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

    isActive: z
      .boolean({ invalid_type_error: "El valor debe ser booleano" })
      .optional(),

    tiers: z.array(promoTier).min(1, "Debés definir al menos un escalón de descuento").optional(),

    productIds: productIdsField.optional(),
  })
  .strip();

export const promoQuery = z.object({
  // z.coerce.boolean() convertiría "false" (string no vacío) en `true` — por eso se
  // valida contra los dos literales posibles en vez de coercionar.
  isActive: z
    .enum(["true", "false"], { invalid_type_error: "El valor debe ser true o false" })
    .transform((v) => v === "true")
    .optional(),

  productId: z.coerce
    .number({ invalid_type_error: "El ID de producto debe ser un número" })
    .int("El ID de producto debe ser un número entero")
    .positive("ID de producto inválido")
    .optional(),

  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(100, "El límite máximo es 100")
    .default(10),

  offset: z.coerce.number().int().min(0).default(0),
});
