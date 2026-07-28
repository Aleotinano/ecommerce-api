import { z } from "zod";

export const getTenantConfig = z.object({
  tenantId: z.coerce
    .number({ invalid_type_error: "El ID debe ser un número" })
    .int("El ID debe ser un número entero")
    .positive("El ID del tenant es inválido"),
});

/**
 * Un override de sección. Se valida la FORMA (qué ejes, qué enums) pero no los ids
 * de tipografía, por lo mismo que en `themeFontDisplay`: el catálogo vive en
 * @repo/shared y crece sin deploy del backend. El filtro final lo hace
 * `normalizeSectionThemes` al renderizar.
 *
 * `.strict()`: una clave desconocida se rechaza en vez de guardarse como basura
 * que después nadie lee.
 */
const sectionOverride = z
  .object({
    fontDisplay: z.string().trim().max(40).optional(),
    fontBody: z.string().trim().max(40).optional(),
    weightDisplay: z.enum(["400", "500", "600", "700"]).optional(),
    weightBody: z.enum(["400", "500", "600", "700"]).optional(),
    radius: z.enum(["duro", "sutil", "suave", "redondo"]).optional(),
    density: z.enum(["compacto", "aireado"]).optional(),
  })
  .strict();

const updateTenantConfigObject = z
  .object({
    storeName: z
      .string({ invalid_type_error: "El nombre debe ser texto" })
      .max(100, "El nombre es demasiado largo")
      .trim()
      .nullable()
      .optional(),

    storeDescription: z
      .string({ invalid_type_error: "La descripción debe ser texto" })
      .max(500, "La descripción es demasiado larga")
      .trim()
      .nullable()
      .optional(),

    storeTagline: z
      .string({ invalid_type_error: "El tagline debe ser texto" })
      .max(150, "El tagline es demasiado largo")
      .trim()
      .nullable()
      .optional(),

    contactEmail: z
      .string({ invalid_type_error: "El email debe ser texto" })
      .email("Email inválido")
      .nullable()
      .optional(),

    contactPhone: z
      .string({ invalid_type_error: "El teléfono debe ser texto" })
      .max(20, "El teléfono es demasiado largo")
      .nullable()
      .optional(),

    contactAddress: z
      .string({ invalid_type_error: "La dirección debe ser texto" })
      .max(300, "La dirección es demasiado larga")
      .nullable()
      .optional(),

    socialInstagram: z
      .string({ invalid_type_error: "Instagram debe ser texto" })
      .url("Instagram debe ser una URL válida")
      .nullable()
      .optional(),

    socialTiktok: z
      .string({ invalid_type_error: "TikTok debe ser texto" })
      .url("TikTok debe ser una URL válida")
      .nullable()
      .optional(),

    socialFacebook: z
      .string({ invalid_type_error: "Facebook debe ser texto" })
      .url("Facebook debe ser una URL válida")
      .nullable()
      .optional(),

    socialTwitter: z
      .string({ invalid_type_error: "Twitter debe ser texto" })
      .url("Twitter debe ser una URL válida")
      .nullable()
      .optional(),

    socialYoutube: z
      .string({ invalid_type_error: "YouTube debe ser texto" })
      .url("YouTube debe ser una URL válida")
      .nullable()
      .optional(),

    socialPinterest: z
      .string({ invalid_type_error: "Pinterest debe ser texto" })
      .url("Pinterest debe ser una URL válida")
      .nullable()
      .optional(),

    socialWhatsapp: z
      .string({ invalid_type_error: "WhatsApp debe ser texto" })
      .max(20, "El número de WhatsApp es demasiado largo")
      .nullable()
      .optional(),

    // phone_number_id del numero de WhatsApp Business (Graph API), no el telefono.
    // null para desconectar.
    whatsappPhoneNumberId: z
      .string({ invalid_type_error: "phone_number_id debe ser texto" })
      .regex(/^\d{5,20}$/, "phone_number_id inválido (solo dígitos)")
      .nullable()
      .optional(),

    // Access token de la Graph API de la marca. Se cifra antes de guardar y
    // nunca se devuelve por la API. null para desconectar (usa token de env).
    whatsappAccessToken: z
      .string({ invalid_type_error: "El access token debe ser texto" })
      .min(1, "El access token no puede estar vacío")
      .max(500, "El access token es demasiado largo")
      .trim()
      .nullable()
      .optional(),

    seoTitle: z
      .string({ invalid_type_error: "SEO title debe ser texto" })
      .max(60, "SEO title debe tener max 60 caracteres")
      .trim()
      .nullable()
      .optional(),

    seoDescription: z
      .string({ invalid_type_error: "SEO description debe ser texto" })
      .max(160, "SEO description debe tener max 160 caracteres")
      .trim()
      .nullable()
      .optional(),

    seoKeywords: z
      .string({ invalid_type_error: "Keywords deben ser texto" })
      .max(200, "Keywords son demasiadas")
      .trim()
      .nullable()
      .optional(),

    shippingPolicy: z
      .string({ invalid_type_error: "Shipping policy debe ser texto" })
      .max(2000, "Shipping policy es demasiada")
      .trim()
      .nullable()
      .optional(),

    returnsPolicy: z
      .string({ invalid_type_error: "Returns policy debe ser texto" })
      .max(2000, "Returns policy es demasiada")
      .trim()
      .nullable()
      .optional(),

    privacyPolicy: z
      .string({ invalid_type_error: "Privacy policy debe ser texto" })
      .max(2000, "Privacy policy es demasiada")
      .trim()
      .nullable()
      .optional(),

    // ── Teléfono del cliente ─────────────────────────────────────────────────
    // OJO: esto NO es `contactPhone` (que es el teléfono DEL NEGOCIO, unos
    // campos más arriba). Acá se configura si se le pide el número A QUIEN
    // COMPRA, y con qué prefijos se completa lo que tipea.
    customerPhoneMode: z
      .enum(["off", "optional", "required"], {
        invalid_type_error: "Modo de teléfono inválido",
      })
      .nullable()
      .optional(),

    // País y característica terminan concatenados a un número que se manda a
    // wa.me, así que se exigen dígitos pelados. Hay CHECK equivalente en la DB.
    customerPhoneCountry: z
      .string({ invalid_type_error: "El código de país debe ser texto" })
      .trim()
      .regex(/^\d{1,4}$/, "El código de país debe ser de 1 a 4 dígitos")
      .nullable()
      .optional(),

    customerPhoneArea: z
      .string({ invalid_type_error: "La característica debe ser texto" })
      .trim()
      .regex(/^\d{2,5}$/, "La característica debe ser de 2 a 5 dígitos")
      .nullable()
      .optional(),

    currency: z
      .string({ invalid_type_error: "Currency debe ser texto" })
      .length(3, "Currency debe ser código ISO de 3 letras")
      .toUpperCase()
      .nullable()
      .optional(),

    locale: z
      .string({ invalid_type_error: "Locale debe ser texto" })
      .regex(/^[a-z]{2}-[A-Z]{2}$/, "Locale debe ser formato xx-YY")
      .nullable()
      .optional(),

    showOutOfStock: z
      .boolean({ invalid_type_error: "showOutOfStock debe ser booleano" })
      .nullable()
      .optional(),

    allowCartGuest: z
      .boolean({ invalid_type_error: "allowCartGuest debe ser booleano" })
      .nullable()
      .optional(),

    depositEnabled: z
      .boolean({ invalid_type_error: "depositEnabled debe ser booleano" })
      .nullable()
      .optional(),

    depositPercentage: z
      .number({ invalid_type_error: "depositPercentage debe ser un número" })
      .int("depositPercentage debe ser entero")
      .min(0, "depositPercentage no puede ser menor a 0")
      .max(100, "depositPercentage no puede superar 100")
      .nullable()
      .optional(),

    productVariantsEnabled: z
      .boolean({ invalid_type_error: "productVariantsEnabled debe ser booleano" })
      .nullable()
      .optional(),

    // ── Tema de la tienda ────────────────────────────────────────────────────
    // null en cualquiera de estos = "volver al default" (el storefront resuelve).
    //
    // El accent es el único campo de forma libre del tema y termina como valor de
    // una CSS custom property en un atributo `style`. Se exige #rrggbb exacto: sin
    // formas de 3 dígitos, sin rgb(), sin nombres CSS. Cualquier laxitud acá abre
    // la puerta a valores tipo `url(...)`, que en una var consumida por background
    // sería exfiltración. Hay un CHECK equivalente en la DB.
    themeAccent: z
      .string({ invalid_type_error: "El color debe ser texto" })
      .trim()
      .toLowerCase()
      .regex(/^#[0-9a-f]{6}$/, "El color debe ser hexadecimal #rrggbb")
      .nullable()
      .optional(),

    themeRadius: z
      .enum(["duro", "sutil", "suave", "redondo"], {
        invalid_type_error: "Radio inválido",
      })
      .nullable()
      .optional(),

    // Los ids de fuente NO se validan contra un enum acá a propósito: el catálogo
    // vive en @repo/shared y crece sin migración ni deploy del backend. La frontera
    // real es `normalizeStoreTheme` en el render, que descarta cualquier id que no
    // esté en el catálogo (y que no sirva para ese rol). Acá solo se acota el largo.
    themeFontDisplay: z
      .string({ invalid_type_error: "La tipografía debe ser texto" })
      .trim()
      .max(40, "Identificador de tipografía demasiado largo")
      .nullable()
      .optional(),

    themeFontBody: z
      .string({ invalid_type_error: "La tipografía debe ser texto" })
      .trim()
      .max(40, "Identificador de tipografía demasiado largo")
      .nullable()
      .optional(),

    // Peso por rol. Enum cerrado y estable, con CHECK equivalente en la DB. Que la
    // fuente elegida SOPORTE ese peso (Bebas trae uno solo) no se valida acá: eso
    // depende del catálogo, que vive en @repo/shared y crece sin deploy del
    // backend. Lo clampea `normalizeStoreTheme` al renderizar.
    themeWeightDisplay: z
      .enum(["400", "500", "600", "700"], {
        invalid_type_error: "Peso inválido",
      })
      .nullable()
      .optional(),

    themeWeightBody: z
      .enum(["400", "500", "600", "700"], {
        invalid_type_error: "Peso inválido",
      })
      .nullable()
      .optional(),

    themeDensity: z
      .enum(["compacto", "aireado"], { invalid_type_error: "Densidad inválida" })
      .nullable()
      .optional(),

    // Overrides por sección. Se valida la FORMA (qué secciones, qué ejes, qué
    // enums) pero no los ids de tipografía, por lo mismo que en themeFontDisplay:
    // el catálogo vive en @repo/shared y crece sin deploy del backend. El filtro
    // final lo hace `normalizeSectionThemes` al renderizar.
    // `.strict()` en el override: una clave desconocida se rechaza en vez de
    // guardarse como basura que después nadie lee.
    // Objeto con secciones opcionales y no `z.record(z.enum(...))`: en Zod 4 un
    // record con clave enum exige que estén TODAS las claves, así que guardar solo
    // el nav fallaba pidiendo hero/catalog/footer.
    themeSections: z
      .object({
        nav: sectionOverride.optional(),
        hero: sectionOverride.optional(),
        catalog: sectionOverride.optional(),
        footer: sectionOverride.optional(),
      })
      .strict()
      .nullable()
      .optional(),
  });

export const updateTenantConfig = updateTenantConfigObject.refine(
  (data) => Object.values(data).some((value) => value !== undefined),
  { message: "No hay cambios para actualizar" }
);

// Campos actualizables, derivados del schema: el controller arma el `data` de
// persistencia a partir de esta lista, así agregar un campo nuevo al schema
// (y al modelo Prisma) basta para que fluya sin tocar el whitelist a mano.
export const UPDATABLE_TENANT_CONFIG_FIELDS = Object.keys(
  updateTenantConfigObject.shape
);

export const updateTenantConfigLogo = z.object({
  tenantId: z.coerce
    .number({ invalid_type_error: "El ID debe ser un número" })
    .int("El ID debe ser un número entero")
    .positive("El ID del tenant es inválido"),
});

export const deleteTenantConfigLogo = z.object({
  tenantId: z.coerce
    .number({ invalid_type_error: "El ID debe ser un número" })
    .int("El ID debe ser un número entero")
    .positive("El ID del tenant es inválido"),
});
