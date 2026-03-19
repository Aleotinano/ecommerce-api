import { z } from "zod";

export const createVariant = z.object({
  sku: z.string().min(1, "El SKU es requerido"),
  color: z.string().nullable().optional(),
  size: z.string().nullable().optional(),
  price: z.coerce
    .number({ required_error: "El precio es requerido" })
    .positive("El precio debe ser mayor a 0"),
  stock: z.coerce
    .number({ required_error: "El stock es requerido" })
    .int()
    .min(0),
  img: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const updateVariant = z
  .object({
    sku: z.string().min(1).optional(),
    color: z.string().nullable().optional(),
    size: z.string().nullable().optional(),
    price: z.coerce.number().positive().optional(),
    stock: z.coerce.number().int().min(0).optional(),
    img: z.string().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Debe proporcionar al menos un campo para actualizar",
  });

export const variantId = z.object({
  variantId: z.coerce
    .number({ invalid_type_error: "El ID debe ser un numero" })
    .int("El ID debe ser un numero entero")
    .positive("ID de variante invalido"),
});
