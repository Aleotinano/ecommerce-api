import { Router } from "express";
import { PromoController } from "../controllers/promos.js";
import { verifyToken } from "../middleware/auth.js";
import { requireRole } from "../middleware/role.js";
import { validate } from "../middleware/validate.js";
import { createPromo, updatePromo, promoQuery } from "../schemas/promo.schema.js";
import { validateId } from "../schemas/id.schema.js";

export const promosRouter = Router();

const roleRequired = ["ADMIN", "STAFF"];

const validation = {
  create: validate({ body: createPromo }),
  update: validate({ params: validateId, body: updatePromo }),
  query: validate({ query: promoQuery }),
  id: validate({ params: validateId }),
};

promosRouter.get("/", verifyToken, validation.query, PromoController.getAll);

promosRouter.get("/:id", verifyToken, validation.id, PromoController.getById);

promosRouter.post(
  "/",
  verifyToken,
  requireRole(roleRequired),
  validation.create,
  PromoController.create
);

promosRouter.patch(
  "/:id",
  verifyToken,
  requireRole(roleRequired),
  validation.update,
  PromoController.edit
);

promosRouter.delete(
  "/:id",
  verifyToken,
  requireRole(roleRequired),
  validation.id,
  PromoController.delete
);
