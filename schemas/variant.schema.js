import { z } from "zod";
import { variantAttributes } from "./tenant-attribute.schema.js";

export const createVariant = z.object({
  // Pares atributo->valor (ej: {"color":"#fff","talle":"M"}). Acá solo se valida el
  // shape; que las keys existan en el catálogo del tenant (y HEX para type COLOR)
  // lo valida el service (TenantAttributeModel.validateAttributes).
  attributes: variantAttributes.optional(),
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
    // Si viene, REEMPLAZA el objeto completo de atributos de la variante (semántica
    // PUT del campo, no merge por key).
    attributes: variantAttributes.optional(),
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

// Listado cross-producto (GET /variants) para el tabulado "Variantes" del admin:
// todas las variantes del tenant, opcionalmente filtradas por producto/nombre.
export const variantListQuery = z.object({
  productId: z.coerce
    .number({ invalid_type_error: "El ID de producto debe ser un número" })
    .int("El ID de producto debe ser un número entero")
    .positive("ID de producto inválido")
    .optional(),
  name: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(100, "El límite máximo es 100")
    .default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const variantId = z.object({
  variantId: z.coerce
    .number({ invalid_type_error: "El ID debe ser un número" })
    .int("El ID debe ser un número entero")
    .positive("ID de variante inválido"),
});
