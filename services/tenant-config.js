import prisma from "../lib/prisma.js";
// `Prisma` (el namespace, no el client) trae `DbNull`. Ver JSON_NULLABLE_FIELDS.
import { Prisma } from "../generated/prisma/index.js";
import { createError } from "../helpers/error.js";
import {
  uploadImageToCloudinary,
  deleteCloudinaryImage,
} from "../lib/imageManager.js";
import { wrap, del, tenantNs } from "../lib/cache.js";
import { encryptSecret } from "../lib/crypto.js";
import {
  READONLY_TENANT_CONFIG_FIELDS,
  UPDATABLE_TENANT_CONFIG_FIELDS,
} from "../schemas/tenant-config.schema.js";

const TENANT_CONFIG_TTL = 600;

/** Campos `Json?` del modelo: necesitan `Prisma.DbNull` para vaciarse de verdad. */
const JSON_NULLABLE_FIELDS = ["themeSections"];

// Proyección pública de la config, derivada del schema Zod para que un campo nuevo
// aparezca en las respuestas sin tocar cada `select` a mano (evita el bug de
// "persiste pero no se refleja"). Se excluye `whatsappAccessToken` (secreto que
// nunca se devuelve) y se agregan campos de solo-display no actualizables (logoUrl)
// más los de flujo de venta, que el tenant lee pero no escribe: el storefront
// necesita saber qué métodos de pago pintar aunque no pueda cambiarlos.
const TENANT_CONFIG_PUBLIC_SELECT = {
  id: true,
  logoUrl: true,
  ...Object.fromEntries(
    [...UPDATABLE_TENANT_CONFIG_FIELDS, ...READONLY_TENANT_CONFIG_FIELDS]
      .filter((field) => field !== "whatsappAccessToken")
      .map((field) => [field, true])
  ),
};

function tenantConfigKey(tenantId) {
  return `${tenantNs(tenantId)}:config`;
}

async function invalidateTenantConfigCache(tenantId) {
  await del(tenantConfigKey(tenantId));
}

export const TenantConfigModel = {
  async get({ tenantId }) {
    const key = tenantConfigKey(tenantId);
    return wrap(key, TENANT_CONFIG_TTL, async () => {
      const config = await prisma.tenantConfig.findUnique({
        where: { tenantId },
        select: TENANT_CONFIG_PUBLIC_SELECT,
      });

      if (!config) {
        throw createError(
          "Configuración del tenant no encontrada",
          "TENANT_CONFIG_NOT_FOUND",
          404
        );
      }

      return config;
    });
  },

  async update({ tenantId, data }) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });

    if (!tenant) {
      throw createError("El tenant no existe", "TENANT_NOT_FOUND", 404);
    }

    // El access token es un secreto: se cifra en reposo (AES-256-GCM). null se
    // guarda tal cual (desconectar -> usa el token global de env).
    if (data.whatsappAccessToken != null) {
      data = {
        ...data,
        whatsappAccessToken: encryptSecret(data.whatsappAccessToken),
      };
    }

    // En un campo Json?, Prisma interpreta `null` como el VALOR JSON null, no
    // como SQL NULL. Eso dejaba la columna con 'null'::jsonb, que no es un objeto
    // y viola el CHECK `TenantConfig_theme_sections_object_check`: limpiar todos
    // los overrides desde el panel devolvía 500. `DbNull` es el que vacía de
    // verdad la columna. Si se agregan más campos Json?, van en esta lista.
    for (const field of JSON_NULLABLE_FIELDS) {
      if (field in data && data[field] === null) {
        data = { ...data, [field]: Prisma.DbNull };
      }
    }

    const config = await prisma.tenantConfig.upsert({
      where: { tenantId },
      update: data,
      create: {
        tenantId,
        ...data,
      },
      select: TENANT_CONFIG_PUBLIC_SELECT,
    });

    await invalidateTenantConfigCache(tenantId);
    return config;
  },

  async uploadLogo({ tenantId, filePath }) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });

    if (!tenant) {
      throw createError("El tenant no existe", "TENANT_NOT_FOUND", 404);
    }

    const uploadedImage = await uploadImageToCloudinary(filePath, {
      entity: "tenant-logos",
    });

    const currentConfig = await prisma.tenantConfig.findUnique({
      where: { tenantId },
      select: { logoPublicId: true },
    });

    if (currentConfig?.logoPublicId) {
      try {
        await deleteCloudinaryImage(currentConfig.logoPublicId);
      } catch (error) {
        console.warn(
          `No se pudo borrar logo anterior de Cloudinary: ${error.message}`
        );
      }
    }

    const config = await prisma.tenantConfig.upsert({
      where: { tenantId },
      update: {
        logoUrl: uploadedImage.img,
        logoPublicId: uploadedImage.imgPublicId,
      },
      create: {
        tenantId,
        logoUrl: uploadedImage.img,
        logoPublicId: uploadedImage.imgPublicId,
      },
      select: {
        id: true,
        logoUrl: true,
        storeName: true,
      },
    });

    await invalidateTenantConfigCache(tenantId);
    return config;
  },

  async deleteLogo({ tenantId }) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });

    if (!tenant) {
      throw createError("El tenant no existe", "TENANT_NOT_FOUND", 404);
    }

    const config = await prisma.tenantConfig.findUnique({
      where: { tenantId },
      select: { logoPublicId: true },
    });

    if (!config || !config.logoPublicId) {
      throw createError(
        "El tenant no tiene logo para borrar",
        "NO_LOGO_TO_DELETE",
        404
      );
    }

    try {
      await deleteCloudinaryImage(config.logoPublicId);
    } catch (error) {
      throw createError(
        `Error al borrar imagen de Cloudinary: ${error.message}`,
        "CLOUDINARY_DELETE_ERROR",
        500
      );
    }

    const updatedConfig = await prisma.tenantConfig.update({
      where: { tenantId },
      data: {
        logoUrl: null,
        logoPublicId: null,
      },
      select: {
        id: true,
        logoUrl: true,
        storeName: true,
      },
    });

    await invalidateTenantConfigCache(tenantId);
    return updatedConfig;
  },
};
