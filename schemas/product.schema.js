import { z } from "zod";

const variantSchema = z.object({
  size: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  price: z.coerce
    .number({ required_error: "El precio es requerido" })
    .positive("El precio debe ser mayor a 0"),
  stock: z.coerce
    .number({ required_error: "El stock es requerido" })
    .int()
    .min(0),
  sku: z.string().min(1, "El SKU es requerido"),
  img: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const createProduct = z.object({
  name: z.string({ required_error: "El nombre es requerido" }).min(1).max(100),
  description: z.string().max(400).nullable().optional(),
  categoryId: z.coerce.number().int().positive().nullable().optional(),
  img: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  variants: z.array(variantSchema).min(1, "Debe incluir al menos una variante"),
});

export const updateProduct = z
  .object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(400).optional(),
    categoryId: z.number().int().positive().optional(),
    img: z.string().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Debe proporcionar al menos un campo para actualizar",
  });

export const productQuery = z
  .object({
    name: z.string().optional(),
    categoryId: z.coerce.number().int().positive().optional(),
    variantColor: z.string().optional(),
    variantSize: z.string().optional(),
    minPrice: z.coerce.number().positive().optional(),
    maxPrice: z.coerce.number().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).default(10),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine(
    (data) => {
      if (
        data.minPrice !== undefined &&
        data.maxPrice !== undefined &&
        data.minPrice > data.maxPrice
      ) {
        return false;
      }
      return true;
    },
    {
      message: "El precio mínimo no puede ser mayor al máximo",
      path: ["maxPrice"],
    }
  );
