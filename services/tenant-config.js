import prisma from "../lib/prisma.js";
import { createError } from "../helpers/error.js";
import {
  uploadImageToCloudinary,
  deleteCloudinaryImage,
} from "../lib/imageManager.js";
import { wrap, del, tenantNs } from "../lib/cache.js";
import { encryptSecret } from "../lib/crypto.js";

const TENANT_CONFIG_TTL = 600;

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
        select: {
          id: true,
          storeName: true,
          storeDescription: true,
          storeTagline: true,
          logoUrl: true,
          contactEmail: true,
          contactPhone: true,
          contactAddress: true,
          socialInstagram: true,
          socialTiktok: true,
          socialFacebook: true,
          socialTwitter: true,
          socialYoutube: true,
          socialPinterest: true,
          socialWhatsapp: true,
          whatsappPhoneNumberId: true,
          seoTitle: true,
          seoDescription: true,
          seoKeywords: true,
          shippingPolicy: true,
          returnsPolicy: true,
          privacyPolicy: true,
          currency: true,
          locale: true,
          showOutOfStock: true,
          allowCartGuest: true,
          depositEnabled: true,
          depositPercentage: true,
        },
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

    const config = await prisma.tenantConfig.upsert({
      where: { tenantId },
      update: data,
      create: {
        tenantId,
        ...data,
      },
      select: {
        id: true,
        storeName: true,
        storeDescription: true,
        storeTagline: true,
        logoUrl: true,
        contactEmail: true,
        contactPhone: true,
        contactAddress: true,
        socialInstagram: true,
        socialTiktok: true,
        socialFacebook: true,
        socialTwitter: true,
        socialYoutube: true,
        socialPinterest: true,
        socialWhatsapp: true,
        whatsappPhoneNumberId: true,
        seoTitle: true,
        seoDescription: true,
        seoKeywords: true,
        shippingPolicy: true,
        returnsPolicy: true,
        privacyPolicy: true,
        currency: true,
        locale: true,
        showOutOfStock: true,
        allowCartGuest: true,
      },
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
