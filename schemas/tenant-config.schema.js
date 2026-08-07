import { z } from "zod";

import {
  MAX_SHIFTS,
  findScheduleOverlap,
  parseSchedule,
} from "../services/cash-register-schedule.js";

// Hora del día en 24 h. El módulo de horarios usa el mismo patrón para parsear;
// acá se repite como regex de Zod para que el error salga por campo.
const HHMM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

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

/** Las tres credenciales de Cloudinary, que viajan siempre juntas. */
export const CLOUDINARY_CREDENTIAL_FIELDS = [
  "cloudinaryCloudName",
  "cloudinaryApiKey",
  "cloudinaryApiSecret",
];

/**
 * Campos que se guardan **cifrados** (lib/crypto.js) y que **nunca** salen por la
 * API. Los consume `services/tenant-config.js` para dos cosas: cifrar al escribir y
 * excluirlos de la proyección pública. Un campo secreto nuevo se agrega acá y queda
 * cubierto en los dos lados — que es justo lo que evita el bug de estrenar un
 * secreto que se devuelve en el GET sin que nadie lo note.
 *
 * `cloudinaryCloudName` NO está: no es un secreto, y devolverlo es lo que le
 * permite al panel mostrar si el tenant tiene cuenta propia (por el CHECK, si está
 * el cloud name están las tres).
 */
export const SECRET_TENANT_CONFIG_FIELDS = [
  "whatsappAccessToken",
  "cloudinaryApiKey",
  "cloudinaryApiSecret",
];

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

    // ── Cuenta de Cloudinary del cliente ─────────────────────────────────────
    // Van los tres juntos o los tres en null (ver `cloudinaryCredentialsTogether`
    // más abajo y el CHECK equivalente en la DB). El `cloud_name` vuelve en el GET;
    // los otros dos se cifran y no salen nunca.
    //
    // Los formatos NO se validan a fondo a propósito: el que descubre un
    // `api_secret` mal pegado es el ping contra Cloudinary al guardar
    // (`verifyCredentials`), no una regex que adivine el formato del proveedor.
    cloudinaryCloudName: z
      .string({ invalid_type_error: "El cloud name debe ser texto" })
      .trim()
      .min(1, "El cloud name no puede estar vacío")
      .max(100, "El cloud name es demasiado largo")
      .nullable()
      .optional(),

    cloudinaryApiKey: z
      .string({ invalid_type_error: "La API key debe ser texto" })
      .trim()
      .min(1, "La API key no puede estar vacía")
      .max(100, "La API key es demasiado larga")
      .nullable()
      .optional(),

    cloudinaryApiSecret: z
      .string({ invalid_type_error: "El API secret debe ser texto" })
      .trim()
      .min(1, "El API secret no puede estar vacío")
      .max(200, "El API secret es demasiado largo")
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

    // NO va `depositEnabled`/`depositPercentage` ni los métodos habilitados: son
    // campos de flujo de venta y los configuramos nosotros, no el tenant. Ver
    // READONLY_TENANT_CONFIG_FIELDS al final del archivo.

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

    // Turnos de caja del tenant. `null` (o `[]`) = sin horario: la caja se abre y
    // cierra 100% a mano. Con turnos cargados, un cobro en horario abre el turno
    // solo y el turno queda con vencimiento — ver services/cash-register-schedule.js.
    //
    // Lo edita el tenant: es su horario de atención, cambia con la temporada, y un
    // horario mal puesto no puede bloquear una venta (la apertura automática solo
    // DESBLOQUEA cobros, nunca los impide).
    cashSchedule: z
      .array(
        z
          .object({
            label: z
              .string({ required_error: "El turno necesita un nombre" })
              .min(1, "El nombre del turno no puede estar vacío")
              .max(30, "El nombre del turno es demasiado largo")
              .trim(),
            from: z
              .string({ required_error: "Falta la hora de inicio" })
              .regex(HHMM_PATTERN, "La hora de inicio debe ser HH:MM (24 h)"),
            to: z
              .string({ required_error: "Falta la hora de fin" })
              .regex(HHMM_PATTERN, "La hora de fin debe ser HH:MM (24 h)"),
          })
          .strict()
      )
      .max(MAX_SHIFTS, `No más de ${MAX_SHIFTS} turnos`)
      // Un turno de 08:00 a 08:00 no se puede interpretar: ¿cero minutos o 24 h?
      .refine((shifts) => shifts.every((shift) => shift.from !== shift.to), {
        message: "Un turno no puede empezar y terminar a la misma hora",
      })
      // Dos turnos que se pisan hacen ambigua la pregunta "¿en qué turno estamos?".
      // Se rechaza acá en vez de resolverlo con una regla arbitraria en runtime.
      .superRefine((shifts, ctx) => {
        const overlap = findScheduleOverlap(parseSchedule(shifts));
        if (overlap) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Los turnos "${overlap.a}" y "${overlap.b}" se solapan`,
          });
        }
      })
      .nullable()
      .optional(),
  });

export const updateTenantConfig = updateTenantConfigObject
  // `.passthrough()` es lo que hace posible el chequeo de abajo: por defecto Zod
  // DESCARTA las claves desconocidas antes de correr los refinements, así que un
  // `depositEnabled` nunca llegaría a verse. Dejarlas pasar no abre nada: el
  // controller arma el `data` de persistencia iterando
  // `UPDATABLE_TENANT_CONFIG_FIELDS`, no las claves del body.
  .passthrough()
  // Los campos de flujo de venta se rechazan EXPLÍCITAMENTE. Sin esto, un
  // `PATCH { storeName, depositEnabled }` guardaba el nombre y tiraba la seña a la
  // basura con un 200 en la mano — justo el bug de "persiste pero no se refleja"
  // que este archivo evita en otros lados. Tampoco alcanzaba con `.strict()`: eso
  // rompería a cualquier panel que haga PATCH del payload completo del GET, que
  // incluye `id` y `logoUrl`.
  .superRefine((data, ctx) => {
    for (const field of READONLY_TENANT_CONFIG_FIELDS) {
      if (data[field] !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} no se configura desde el panel: es parte del flujo de venta del tenant y lo configuramos nosotros`,
        });
      }
    }
  })
  .superRefine(cloudinaryCredentialsTogether)
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "No hay cambios para actualizar",
  });

/**
 * Las credenciales de Cloudinary se mandan **las tres o ninguna**, y todas con
 * valor o todas en null (null = volver a la cuenta global).
 *
 * No es una restricción arbitraria: media credencial cargada es un tenant que sube
 * a ningún lado, y el error aparecería recién en la primera foto. El CHECK
 * `TenantConfig_cloudinary_credentials_check` dice lo mismo del lado de la DB; esto
 * lo dice antes y con un mensaje que se entiende.
 *
 * Tampoco le pide nada raro al panel: el `api_secret` nunca vuelve en el GET, así
 * que editar una sola de las tres no era posible de todos modos.
 */
function cloudinaryCredentialsTogether(data, ctx) {
  const present = CLOUDINARY_CREDENTIAL_FIELDS.filter(
    (field) => data[field] !== undefined
  );
  if (present.length === 0) return;

  if (present.length !== CLOUDINARY_CREDENTIAL_FIELDS.length) {
    const missing = CLOUDINARY_CREDENTIAL_FIELDS.filter(
      (field) => data[field] === undefined
    );
    for (const field of missing) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message:
          "Las credenciales de Cloudinary se mandan las tres juntas (cloud name, API key y API secret)",
      });
    }
    return;
  }

  const nulls = present.filter((field) => data[field] === null);
  if (nulls.length > 0 && nulls.length !== present.length) {
    for (const field of nulls) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message:
          "Para volver a la cuenta global las tres credenciales van en null; si no, las tres con valor",
      });
    }
  }
}

// Campos actualizables, derivados del schema: el controller arma el `data` de
// persistencia a partir de esta lista, así agregar un campo nuevo al schema
// (y al modelo Prisma) basta para que fluya sin tocar el whitelist a mano.
export const UPDATABLE_TENANT_CONFIG_FIELDS = Object.keys(
  updateTenantConfigObject.shape
);

/**
 * Campos de la config que el tenant **lee pero no escribe**: el flujo de venta.
 * Deciden cuándo una orden puede producirse y cuánta plata se exige antes, así que
 * los configuramos nosotros — si el admin del tenant pudiera cambiarlos, podría
 * trabar pedidos que ya están en curso (una orden de la semana pasada dejando de
 * poder producirse porque alguien apagó un método de pago).
 *
 * El mecanismo de bloqueo es **estar afuera de `updateTenantConfigObject`**, no un
 * chequeo de rol: `PATCH /tenant-config/:tenantId` corre con
 * `requireRole(["ADMIN"])` y ese ADMIN es el del propio tenant, así que el rol no
 * alcanza para distinguirlo de nosotros. Se setean con un perfil
 * (`services/tenant-profiles.js`) al crear el tenant, y después con
 * `prisma/set-tenant-profile.js`.
 *
 * Van igual en la proyección pública (ver `TENANT_CONFIG_PUBLIC_SELECT` en
 * services/tenant-config.js, que mergea las dos listas): el storefront necesita
 * `paymentMethodsEnabled` para pintar solo los métodos que el tenant acepta, el
 * panel necesita `cashRegisterEnabled` para saber si mostrar el módulo de caja, y
 * `storeMode` decide si la tienda tiene carrito.
 */
export const READONLY_TENANT_CONFIG_FIELDS = [
  // Si el catálogo se compra o solo se lee. Es lo más drástico de la lista: en
  // "MENU" el storefront apaga el checkout entero. Justamente por eso no lo
  // toca el tenant — el que se lo prendiera sin querer se quedaría sin ventas y
  // sin ningún error que se lo explique. Se setea con el perfil `carta`.
  "storeMode",
  "paymentMethodsEnabled",
  "fulfillmentMethodsEnabled",
  "depositEnabled",
  "depositPercentage",
  // La caja no es un perfil de venta, pero es de la misma clase: prendida, cobrar
  // sin turno abierto FALLA. Si el tenant pudiera apagarla, un cobro dejaría de
  // impactar en el arqueo sin que nadie se enterara. Se setea con
  // `prisma/set-cash-register.js`.
  "cashRegisterEnabled",
];

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
