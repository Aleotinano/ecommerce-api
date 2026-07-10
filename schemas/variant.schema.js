import { z } from "zod";

export const createVariant = z.object({
  color: z
    .string({ invalid_type_error: "El color debe ser texto" })
    .regex(
      /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/,
      "El color debe ser un HEX válido (ej: #1A2B3C o #ABC)"
    )
    .nullable()
    .optional(),
  size: z
    .string({ invalid_type_error: "La talla debe ser texto" })
    .nullable()
    .optional(),
  // Requerido: ya no existe `Product.price` al que una variante pueda "heredar" si
  // se omite — cada variante tiene siempre su propio precio.
  price: z.coerce
    .number({
      required_error: "El precio es requerido",
      invalid_type_error: "El precio debe ser un número",
    })
    .positive("El precio debe ser mayor a 0"),
  stock: z.coerce
    .number({
      required_error: "El stock es requerido",
      invalid_type_error: "El stock debe ser un número",
    })
    .int("El stock debe ser un número entero")
    .min(0, "El stock no puede ser negativo"),
  img: z
    .string({ invalid_type_error: "La imagen debe ser texto" })
    .url("La URL de la imagen no es válida")
    .nullable()
    .optional(),
  isActive: z
    .boolean({ invalid_type_error: "El valor debe ser booleano" })
    .optional(),
});

export const updateVariant = z
  .object({
    color: z
      .string({ invalid_type_error: "El color debe ser texto" })
      .regex(
        /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/,
        "El color debe ser un HEX válido (ej: #1A2B3C o #ABC)"
      )
      .nullable()
      .optional(),
    size: z
      .string({ invalid_type_error: "La talla debe ser texto" })
      .nullable()
      .optional(),
    // Optional (no hace falta reenviar el precio si no cambia), pero si viene ya no
    // acepta null — no hay "volver a heredar", cada variante siempre tiene precio.
    price: z.coerce
      .number({ invalid_type_error: "El precio debe ser un número" })
      .positive("El precio debe ser mayor a 0")
      .optional(),
    stock: z.coerce
      .number({ invalid_type_error: "El stock debe ser un número" })
      .int("El stock debe ser un número entero")
      .min(0, "El stock no puede ser negativo")
      .optional(),
    img: z
      .url({ invalid_type_error: "La URL de la imagen no es válida" })
      .nullable()
      .optional(),
    isActive: z
      .boolean({ invalid_type_error: "El valor debe ser booleano" })
      .optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: "Debes enviar al menos un campo para actualizar",
  });

export const variantParams = z.object({
  productId: z.coerce
    .number({ invalid_type_error: "El ID debe ser un número" })
    .int("El ID debe ser un número entero")
    .positive("ID de producto inválido"),
  id: z.coerce
    .number({ invalid_type_error: "El ID debe ser un número" })
    .int("El ID debe ser un número entero")
    .positive("ID de variante inválido")
    .optional(),
});

export const variantId = z.object({
  variantId: z.coerce
    .number({ invalid_type_error: "El ID debe ser un número" })
    .int("El ID debe ser un número entero")
    .positive("ID de variante inválido"),
});
