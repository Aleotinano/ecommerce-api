import { TenantConfigModel } from "../services/tenant-config.js";
import {
  cleanupUploadedImage,
  getUploadedImageFile,
} from "../middleware/upload.js";

export class TenantConfigController {
  static async get(req, res, next) {
    try {
      const { tenantId } = req.params;

      const config = await TenantConfigModel.get({
        tenantId: parseInt(tenantId),
      });

      res.json(config);
    } catch (error) {
      next(error);
    }
  }

  static async update(req, res, next) {
    try {
      const { tenantId } = req.params;
      const {
        storeName,
        storeDescription,
        storeTagline,
        contactEmail,
        contactPhone,
        contactAddress,
        socialInstagram,
        socialTiktok,
        socialFacebook,
        socialTwitter,
        socialYoutube,
        socialPinterest,
        socialWhatsapp,
        seoTitle,
        seoDescription,
        seoKeywords,
        shippingPolicy,
        returnsPolicy,
        privacyPolicy,
        currency,
        locale,
        showOutOfStock,
        allowCartGuest,
        depositEnabled,
        depositPercentage,
      } = req.body;

      const data = {};
      if (storeName !== undefined) data.storeName = storeName;
      if (storeDescription !== undefined) data.storeDescription = storeDescription;
      if (storeTagline !== undefined) data.storeTagline = storeTagline;
      if (contactEmail !== undefined) data.contactEmail = contactEmail;
      if (contactPhone !== undefined) data.contactPhone = contactPhone;
      if (contactAddress !== undefined) data.contactAddress = contactAddress;
      if (socialInstagram !== undefined) data.socialInstagram = socialInstagram;
      if (socialTiktok !== undefined) data.socialTiktok = socialTiktok;
      if (socialFacebook !== undefined) data.socialFacebook = socialFacebook;
      if (socialTwitter !== undefined) data.socialTwitter = socialTwitter;
      if (socialYoutube !== undefined) data.socialYoutube = socialYoutube;
      if (socialPinterest !== undefined) data.socialPinterest = socialPinterest;
      if (socialWhatsapp !== undefined) data.socialWhatsapp = socialWhatsapp;
      if (seoTitle !== undefined) data.seoTitle = seoTitle;
      if (seoDescription !== undefined) data.seoDescription = seoDescription;
      if (seoKeywords !== undefined) data.seoKeywords = seoKeywords;
      if (shippingPolicy !== undefined) data.shippingPolicy = shippingPolicy;
      if (returnsPolicy !== undefined) data.returnsPolicy = returnsPolicy;
      if (privacyPolicy !== undefined) data.privacyPolicy = privacyPolicy;
      if (currency !== undefined) data.currency = currency;
      if (locale !== undefined) data.locale = locale;
      if (showOutOfStock !== undefined) data.showOutOfStock = showOutOfStock;
      if (allowCartGuest !== undefined) data.allowCartGuest = allowCartGuest;
      if (depositEnabled !== undefined) data.depositEnabled = depositEnabled;
      if (depositPercentage !== undefined) data.depositPercentage = depositPercentage;

      const config = await TenantConfigModel.update({
        tenantId: parseInt(tenantId),
        data,
      });

      res.json({
        message: "Configuración actualizada",
        config,
      });
    } catch (error) {
      next(error);
    }
  }

  static async uploadLogo(req, res, next) {
    const uploadedFile = getUploadedImageFile(req);

    try {
      if (!uploadedFile) {
        throw new Error("No image file provided");
      }

      const { tenantId } = req.params;

      const config = await TenantConfigModel.uploadLogo({
        tenantId: parseInt(tenantId),
        filePath: uploadedFile.path,
      });

      res.json({
        message: "Logo actualizado",
        config,
      });
    } catch (error) {
      await cleanupUploadedImage(req);
      next(error);
    }
  }

  static async deleteLogo(req, res, next) {
    try {
      const { tenantId } = req.params;

      const config = await TenantConfigModel.deleteLogo({
        tenantId: parseInt(tenantId),
      });

      res.json({
        message: "Logo eliminado",
        config,
      });
    } catch (error) {
      next(error);
    }
  }
}
