import { Router } from "express";
import { z } from "zod";

import { variantsController } from "../controllers/variants.js";
import { requireRole } from "../middleware/role.js";
import { verifyToken } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  normalizeMultipartBody,
  requireBodyOrImage,
  uploadImage,
} from "../middleware/upload.js";
import { createVariant, updateVariant } from "../schemas/variant.schema.js";

const productIdSchema = z.object({
  productId: z.coerce.number().int().positive(),
});

const productAndVariantId = z.object({
  productId: z.coerce.number().int().positive(),
  id: z.coerce.number().int().positive(),
});

export const variantRouter = Router();

const roleRequired = "ADMIN";

const validation = {
  productId: validate({ params: productIdSchema }),
  create: validate({
    params: productIdSchema,
    body: createVariant,
  }),
  update: validate({ params: productAndVariantId, body: updateVariant }),
  id: validate({ params: productAndVariantId }),
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
