import { Router } from "express";
import { variantsController } from "../controllers/variants.js";
import { requireRole } from "../middleware/role.js";
import { verifyToken } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  normalizeMultipartBody,
  requireBodyOrImage,
  uploadImage,
} from "../middleware/upload.js";
import {
  createVariant,
  updateVariant,
  variantParams,
} from "../schemas/variant.schema.js";

export const variantRouter = Router();

const roleRequired = ["ADMIN"];

const validation = {
  productId: validate({ params: variantParams }),
  create: validate({ params: variantParams, body: createVariant }),
  update: validate({ params: variantParams, body: updateVariant }),
  id: validate({ params: variantParams }),
};

variantRouter.get(
  "/:productId",
  verifyToken,
  requireRole(roleRequired),
  validation.productId,
  variantsController.getAll
);

variantRouter.post(
  "/:productId",
  verifyToken,
  requireRole(roleRequired),
  uploadImage,
  normalizeMultipartBody,
  validation.create,
  variantsController.create
);

variantRouter.patch(
  "/:productId/:id",
  verifyToken,
  requireRole(roleRequired),
  uploadImage,
  normalizeMultipartBody,
  requireBodyOrImage,
  validation.update,
  variantsController.edit
);

variantRouter.delete(
  "/:productId/:id",
  verifyToken,
  requireRole(roleRequired),
  validation.id,
  variantsController.delete
);
