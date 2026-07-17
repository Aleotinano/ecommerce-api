import { TenantConfigModel } from "../services/tenant-config.js";
import {
  cleanupUploadedImage,
  getUploadedImageFile,
} from "../middleware/upload.js";
import { UPDATABLE_TENANT_CONFIG_FIELDS } from "../schemas/tenant-config.schema.js";

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

      // Whitelist derivado del schema Zod: solo se persisten los campos que el
      // body trae explícitamente. `req.body` ya viene validado y con las claves
      // desconocidas descartadas (ver middleware/validate.js).
      const data = {};
      for (const field of UPDATABLE_TENANT_CONFIG_FIELDS) {
        if (req.body[field] !== undefined) {
          data[field] = req.body[field];
        }
      }

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
