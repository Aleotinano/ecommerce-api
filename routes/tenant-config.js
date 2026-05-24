import { Router } from "express";
import { TenantConfigController } from "../controllers/tenant-config.js";
import { verifyToken, attachUser } from "../middleware/auth.js";
import { requireRole } from "../middleware/role.js";
import { validate } from "../middleware/validate.js";
import {
  uploadImage,
  normalizeMultipartBody,
} from "../middleware/upload.js";
import {
  getTenantConfig,
  updateTenantConfig,
  updateTenantConfigLogo,
  deleteTenantConfigLogo,
} from "../schemas/tenant-config.schema.js";

export const tenantConfigRouter = Router();

const roleRequired = ["ADMIN"];

const validation = {
  getId: validate({ params: getTenantConfig }),
  update: validate({ params: getTenantConfig, body: updateTenantConfig }),
  uploadLogo: validate({ params: updateTenantConfigLogo }),
  deleteLogo: validate({ params: deleteTenantConfigLogo }),
};

tenantConfigRouter.get(
  "/:tenantId",
  attachUser,
  validation.getId,
  TenantConfigController.get
);

tenantConfigRouter.patch(
  "/:tenantId",
  verifyToken,
  requireRole(roleRequired),
  validation.update,
  TenantConfigController.update
);

tenantConfigRouter.patch(
  "/:tenantId/logo",
  verifyToken,
  requireRole(roleRequired),
  uploadImage,
  normalizeMultipartBody,
  validation.uploadLogo,
  TenantConfigController.uploadLogo
);

tenantConfigRouter.delete(
  "/:tenantId/logo",
  verifyToken,
  requireRole(roleRequired),
  validation.deleteLogo,
  TenantConfigController.deleteLogo
);
