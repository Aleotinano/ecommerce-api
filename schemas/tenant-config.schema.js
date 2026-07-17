import { z } from "zod";

export const getTenantConfig = z.object({
  tenantId: z.coerce
    .number({ invalid_type_error: "El ID debe ser un número" })
    .int("El ID debe ser un número entero")
    .positive("El ID del tenant es inválido"),
});

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
