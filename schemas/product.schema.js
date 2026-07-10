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

// Combos: una fila de la whitelist de CATEGORÍAS enteras permitidas dentro de un combo
// (alternativa a listar productos uno por uno con `comboOption`).
export const comboCategoryOption = z.object({
  categoryId: z.coerce
    .number({ invalid_type_error: "El ID de categoría debe ser un número" })
    .int("El ID de categoría debe ser un número entero")
    .positive("ID de categoría inválido"),
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

// PRODUCTO: siempre tiene >=1 ProductVariant (la principal marcada `isDefault`) —
// precio/stock viven ahí, nunca en columnas de Product. COMBO: producto compuesto de
// otros productos; `price` es su precio fijo. Ver docs/servicios/dominio/Productos.md
// y Combos.md.
export const PRODUCT_TYPES = ["PRODUCTO", "COMBO"];

export const createProduct = z
  .object({
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
    // Exclusivo de COMBO (precio fijo). Para PRODUCTO el precio vive en cada
    // variante — no se acepta acá (ver superRefine).
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
    type: z.enum(PRODUCT_TYPES, {
      required_error: "El tipo de producto es requerido",
      invalid_type_error: "Tipo de producto inválido",
    }),
    // PRODUCTO: variantes iniciales, puede venir vacío (alta en 2 pasos — la
    // principal se agrega después vía /variants/:productId). COMBO: prohibido.
    variants: z.array(createVariant).optional().default([]),
    // Combos: solo aplica si type=COMBO (ver docs/servicios/dominio/Combos.md).
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
    comboCategoryOptions: z.array(comboCategoryOption).optional().default([]),
  })
  .superRefine((data, ctx) => {
    if (data.type === "COMBO") {
      if (data.variants.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["variants"],
          message: "Un combo no admite variantes",
        });
      }
      if (data.price === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["price"],
          message: "El precio es requerido para un combo",
        });
      }
      if (data.comboMinItems === undefined || data.comboMaxItems === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["comboMinItems"],
          message: "comboMinItems y comboMaxItems son requeridos para un combo",
        });
      }
    } else if (data.price !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["price"],
        message: "El precio de un producto vive en cada variante, no a nivel producto",
      });
    }
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
    // Cambiar `type` dispara una transición (ver ProductModel.edit): las variantes
    // reales o la whitelist de combo que dejan de aplicar se desactivan, nunca se
    // borran. Enviar `type` sin cambiarlo respecto al actual es un no-op.
    type: z.enum(PRODUCT_TYPES, { invalid_type_error: "Tipo de producto inválido" }).optional(),
    // Variantes nuevas al pasar el producto a PRODUCTO (alta inicial; el CRUD
    // ongoing de variantes vive en /variants/:productId).
    variants: z.array(createVariant).optional(),
    // Combos: ver docs/servicios/dominio/Combos.md. `comboOptions` reemplaza la
    // whitelist completa si se envía (no hay merge incremental en v1).
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
    comboCategoryOptions: z.array(comboCategoryOption).optional(),
  })
  // Sin `.refine` de "al menos un campo": el caso vacío (ni body ni imagen) ya lo
  // corta `requireBodyOrImage` en la ruta, y ese refine rechazaba los updates que
  // mandan SOLO una imagen (que viaja en req.files, no en req.body).
  .strip()
  // Solo valida cuando `type` viene explícito en el request (confirmando o
  // cambiando el tipo) — si se omite, la transición no aplica y la regla no
  // corresponde chequearla acá (el servicio ya sabe el tipo actual).
  .superRefine((data, ctx) => {
    if (data.type === "PRODUCTO" && data.price !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["price"],
        message: "El precio de un producto vive en cada variante, no a nivel producto",
      });
    }
    if (data.type === "COMBO" && Array.isArray(data.variants) && data.variants.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["variants"],
        message: "Un combo no admite variantes",
      });
    }
  });

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

// Param `:productId` (rutas de carrito: POST/PATCH /cart/:productId,
// POST /cart/combo/:productId) — mismo formato que `productId` de arriba, distinta
// clave porque el param de la URL se llama distinto en esas rutas.
export const productIdParam = z.object({
  productId: z.coerce
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
