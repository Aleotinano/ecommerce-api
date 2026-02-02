import { Router } from "express";
import { productsController } from "../controllers/productos.js";
import { requireRole } from "../middleware/role.js";
import { verifyToken } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  createProduct,
  productQuery,
  updateProduct,
} from "../schemas/product.schema.js";

import { validateId } from "../schemas/id.schema.js";

export const productosRouter = Router();

const roleRequired = "ADMIN";

const validation = {
  create: validate({ body: createProduct }),
  update: validate({ params: validateId, body: updateProduct }),
  query: validate({ query: productQuery }),
  id: validate({ params: validateId }),
};

productosRouter.get(
  "/",
  verifyToken,
  validation.query,
  productsController.getAll
);

productosRouter.get(
  "/:id",
  verifyToken,
  validation.id,
  productsController.getById
);

productosRouter.post(
  "/",
  verifyToken,
  requireRole(roleRequired),
  validation.create,
  productsController.create
);

productosRouter.patch(
  "/:id",
  verifyToken,
  requireRole(roleRequired),
  validation.update,
  productsController.edit
);

productosRouter.delete(
  "/:id",
  verifyToken,
  requireRole(roleRequired),
  validation.id,
  productsController.delete
);
