import { z } from "zod";
import { createVariant } from "./variant.schema.js";
import { SUGGESTION_ANGLES } from "./content-suggestion.schema.js";

// Tope de la descripción de un producto. 600 y no 400 porque hay cartas que meten la
// ficha nutricional dentro de la descripción (Punto Healthy: "PROTEÍNA 24G | GRASA 3G
// | ..."), y no existe todavía un campo propio para eso — ver
// docs/servicios/Tenants/punto-healthy.md. La columna en Postgres es `text`: el límite
// es de UI, no del modelo.
const DESCRIPTION_MAX = 600;

// Combos: una fila de la whitelist de productos permitidos dentro de un combo.
// Combos: fija la regla a UNA variante del producto permitido. Ausente/null = cualquier
// variante activa (el comportamiento histórico). Con valor, `validateComboSelection`
// rechaza cualquier otra — es lo que permite decir "el pack lleva la caja x48".
const allowedVariantId = z.coerce
  .number({ invalid_type_error: "El ID de variante debe ser un número" })
  .int("El ID de variante debe ser un número entero")
  .positive("ID de variante inválido")
  .nullable()
  .optional();

export const comboOption = z.object({
  allowedProductId: z.coerce
    .number({ invalid_type_error: "El ID de producto debe ser un número" })
    .int("El ID de producto debe ser un número entero")
    .positive("ID de producto inválido"),
  allowedVariantId,
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

// Combos: una fila de la whitelist de CATEGORÍAS permitidas dentro de un combo.
// minQty/maxQty son el TOTAL DEL GRUPO (el admin manda minQty = maxQty = cantidad
// exacta, ej. "4 brownies"); `productIds` son los miembros explícitos permitidos
// dentro de la categoría — vacío = todos sus productos activos.
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
  // Dos formas aceptadas, normalizadas a la misma: un id suelto (`[5, 6]`, lo que
  // mandan el panel y los seeds de siempre) o `{ productId, allowedVariantId }` para
  // fijar la variante de ese miembro. Se normaliza acá a
  // `[{ productId, allowedVariantId }]` para que el service no tenga que distinguir.
  productIds: z
    .array(
      z.union([
        z.coerce
          .number({ invalid_type_error: "El ID de producto debe ser un número" })
          .int("El ID de producto debe ser un número entero")
          .positive("ID de producto inválido"),
        z.object({
          productId: z.coerce
            .number({ invalid_type_error: "El ID de producto debe ser un número" })
            .int("El ID de producto debe ser un número entero")
            .positive("ID de producto inválido"),
          allowedVariantId,
        }),
      ])
    )
    .optional()
    .default([])
    .transform((items) =>
      items.map((item) =>
        typeof item === "object"
          ? { productId: item.productId, allowedVariantId: item.allowedVariantId ?? null }
          : { productId: item, allowedVariantId: null }
      )
    ),
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
      .max(DESCRIPTION_MAX, "La descripción es demasiado larga")
      .trim()
      .nullable()
      .optional(),
    categoryId: z.coerce
      .number({ invalid_type_error: "El ID de categoría debe ser un número" })
      .int("El ID de categoría debe ser un número entero")
      .positive("El ID de categoría es inválido")
      .nullable()
      .optional(),
    // COMBO: precio fijo del combo. PRODUCTO: atajo de alta en 1 paso — junto con
    // `stock` arma la variante default sin necesidad de mandar `variants[]` (ver
    // superRefine: mutuamente excluyente con `variants[]`, y price/stock van juntos).
    price: z.coerce
      .number({ invalid_type_error: "El precio debe ser un número" })
      .positive("El precio debe ser mayor a 0")
      .optional(),
    // Precio de lista para tachar ("antes $X"): el ahorro que se muestra es
    // `compareAtPrice - price`. Solo COMBO, igual que `price`. Es un dato cargado
    // (lo que costarían los componentes sueltos según la carta), no se recalcula.
    compareAtPrice: z.coerce
      .number({ invalid_type_error: "El precio de lista debe ser un número" })
      .positive("El precio de lista debe ser mayor a 0")
      .nullable()
      .optional(),
    // Solo aplica a PRODUCTO, junto con `price` (ver comentario de `price` arriba).
    stock: z.coerce
      .number({ invalid_type_error: "El stock debe ser un número" })
      .int("El stock debe ser un número entero")
      .min(0, "El stock no puede ser negativo")
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
    // Si viene `comboCategoryOptions` no vacío, min/max se DERIVAN de la suma de
    // las cantidades por categoría y estos campos se ignoran; solo son requeridos
    // en el camino legacy de whitelist standalone (`comboOptions` sin categorías).
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
      if (
        data.comboCategoryOptions.length === 0 &&
        (data.comboMinItems === undefined || data.comboMaxItems === undefined)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["comboMinItems"],
          message:
            "Un combo necesita categorías con cantidad (comboCategoryOptions) o comboMinItems/comboMaxItems explícitos",
        });
      }
      if (data.stock !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stock"],
          message: "El stock no aplica a combos",
        });
      }
      if (
        data.compareAtPrice != null &&
        data.price !== undefined &&
        data.compareAtPrice <= data.price
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["compareAtPrice"],
          message: "El precio de lista tiene que ser mayor al precio del combo",
        });
      }
    } else {
      // PRODUCTO
      if (data.variants.length > 0 && (data.price !== undefined || data.stock !== undefined)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["variants"],
          message: "Enviá price/stock o variants, no ambos",
        });
      }
      if ((data.price !== undefined) !== (data.stock !== undefined)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: data.price === undefined ? ["price"] : ["stock"],
          message: "price y stock van juntos",
        });
      }
      if (data.compareAtPrice != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["compareAtPrice"],
          message: "El precio de lista solo aplica a combos",
        });
      }
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
      .max(DESCRIPTION_MAX, "La descripción es demasiado larga")
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
    // Precio de lista para tachar ("antes $X"): el ahorro que se muestra es
    // `compareAtPrice - price`. Solo COMBO, igual que `price`. Es un dato cargado
    // (lo que costarían los componentes sueltos según la carta), no se recalcula.
    compareAtPrice: z.coerce
      .number({ invalid_type_error: "El precio de lista debe ser un número" })
      .positive("El precio de lista debe ser mayor a 0")
      .nullable()
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
    if (data.type === "PRODUCTO" && data.compareAtPrice != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["compareAtPrice"],
        message: "El precio de lista solo aplica a combos",
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
    // Filtro por atributos de variante, JSON-encoded en la query string (ej:
    // ?attributes={"color":"%23fff","talle":"M"} URL-encodeado). JSON en un solo
    // param para no depender del query parser de Express para bracket-syntax.
    attributes: z
      .string()
      .transform((value, ctx) => {
        try {
          return JSON.parse(value);
        } catch {
          ctx.addIssue({ code: "custom", message: "attributes debe ser JSON válido" });
          return z.NEVER;
        }
      })
      .pipe(
        z.record(
          z.string().max(30, "Key de atributo demasiado larga"),
          z.string().min(1).max(80, "Valor de atributo demasiado largo")
        )
      )
      .optional(),
    // Filtro por tipo de producto (PRODUCTO/COMBO): match exacto sobre Product.type.
    type: z.enum(PRODUCT_TYPES, { invalid_type_error: "Tipo de producto inválido" }).optional(),
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
