import { Router } from "express";
import { TenantAttributeController } from "../controllers/tenant-attributes.js";
import { verifyToken, attachUser } from "../middleware/auth.js";
import { requireRole } from "../middleware/role.js";
import { validate } from "../middleware/validate.js";
import {
  tenantAttributeParams,
  setupTenantAttributes,
} from "../schemas/tenant-attribute.schema.js";

export const tenantAttributesRouter = Router();

const roleRequired = ["ADMIN"];

const validation = {
  get: validate({ params: tenantAttributeParams }),
  setup: validate({ params: tenantAttributeParams, body: setupTenantAttributes }),
};

tenantAttributesRouter.get(
  "/:tenantId",
  attachUser,
  validation.get,
  TenantAttributeController.get
);

// Setup ONE-TIME del catálogo (onboarding). Si ya existe devuelve 409 — no hay
// edición posterior por API: cambiar el catálogo rompería las variantes existentes.
tenantAttributesRouter.put(
  "/:tenantId",
  verifyToken,
  requireRole(roleRequired),
  validation.setup,
  TenantAttributeController.setup
);
