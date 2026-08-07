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
  invalidateCredentials,
  verifyCredentials,
} from "../lib/cloudinary.js";
import {
  CLOUDINARY_CREDENTIAL_FIELDS,
  READONLY_TENANT_CONFIG_FIELDS,
  SECRET_TENANT_CONFIG_FIELDS,
  UPDATABLE_TENANT_CONFIG_FIELDS,
} from "../schemas/tenant-config.schema.js";

const TENANT_CONFIG_TTL = 600;

/** Campos `Json?` del modelo: necesitan `Prisma.DbNull` para vaciarse de verdad. */
const JSON_NULLABLE_FIELDS = ["themeSections"];

// Proyección pública de la config, derivada del schema Zod para que un campo nuevo
// aparezca en las respuestas sin tocar cada `select` a mano (evita el bug de
// "persiste pero no se refleja"). Se excluyen los campos de
// SECRET_TENANT_CONFIG_FIELDS (secretos que no salen nunca) y se agregan campos de
// solo-display no actualizables (logoUrl) más los de flujo de venta, que el tenant
// lee pero no escribe: el storefront necesita saber qué métodos de pago pintar
// aunque no pueda cambiarlos.
const TENANT_CONFIG_PUBLIC_SELECT = {
  id: true,
  logoUrl: true,
  ...Object.fromEntries(
    [...UPDATABLE_TENANT_CONFIG_FIELDS, ...READONLY_TENANT_CONFIG_FIELDS]
      .filter((field) => !SECRET_TENANT_CONFIG_FIELDS.includes(field))
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

    // Credenciales de Cloudinary: se validan contra el proveedor ANTES de
    // guardarlas. Un `api_secret` mal pegado sin esto no se descubre hasta que
    // alguien sube una imagen y falla, con la config ya persistida. El schema
    // garantiza que vienen las tres o ninguna.
    if (data.cloudinaryCloudName != null) {
      const valid = await verifyCredentials({
        cloudName: data.cloudinaryCloudName,
        apiKey: data.cloudinaryApiKey,
        apiSecret: data.cloudinaryApiSecret,
      });

      if (!valid) {
        throw createError(
          "Cloudinary rechazó esas credenciales: revisá cloud name, API key y API secret",
          "CLOUDINARY_CREDENTIALS_INVALID",
          400
        );
      }
    }

    // Los secretos se cifran en reposo (AES-256-GCM). null se guarda tal cual
    // (desconectar -> se usa el token / la cuenta global de env).
    for (const field of SECRET_TENANT_CONFIG_FIELDS) {
      if (data[field] != null) {
        data = { ...data, [field]: encryptSecret(data[field]) };
      }
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
    // Las credenciales de Cloudinary se cachean en memoria (lib/cloudinary.js): sin
    // esto, la subida siguiente seguiría yendo a la cuenta vieja hasta que venciera
    // el TTL.
    if (CLOUDINARY_CREDENTIAL_FIELDS.some((field) => field in data)) {
      invalidateCredentials(tenantId);
    }

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
      tenantId,
      entity: "tenant-logos",
    });

    const currentConfig = await prisma.tenantConfig.findUnique({
      where: { tenantId },
      select: { logoPublicId: true },
    });

    if (currentConfig?.logoPublicId) {
      try {
        await deleteCloudinaryImage(currentConfig.logoPublicId, { tenantId });
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
      await deleteCloudinaryImage(config.logoPublicId, { tenantId });
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
