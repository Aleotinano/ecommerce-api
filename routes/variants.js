import { Router } from "express";
import { variantsController } from "../controllers/variants.js";
import { requireRole } from "../middleware/role.js";
import { verifyToken } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { validateId } from "../schemas/id.schema.js";
import { createVariant, updateVariant } from "../schemas/variant.schema.js";
import { z } from "zod";

const productAndVariantId = z.object({
  productId: z.coerce.number().int().positive(),
  id: z.coerce.number().int().positive(),
});

export const variantRouter = Router();

const roleRequired = "ADMIN";

const validation = {
  productId: validate({
    params: validateId
      .extend({ id: undefined })
      .extend({ productId: z.coerce.number().int().positive() }),
  }),
  create: validate({
    params: z.object({ productId: z.coerce.number().int().positive() }),
    body: createVariant,
  }),
  update: validate({ params: productAndVariantId, body: updateVariant }),
  id: validate({ params: productAndVariantId }),
};

variantRouter.get(
  "/:productId",
  verifyToken,
  requireRole(roleRequired),
  variantsController.getAll
);
variantRouter.post(
  "/:productId",
  verifyToken,
  requireRole(roleRequired),
  validation.create,
  variantsController.create
);
variantRouter.patch(
  "/:productId/:id",
  verifyToken,
  requireRole(roleRequired),
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
