import { Router } from "express";
import { productsController } from "../controllers/productos.js";
import { requireRole } from "../middleware/role.js";
import { verifyToken } from "../middleware/auth.js";

export const productosRouter = Router();

const roleRequired = "ADMIN";

productosRouter.get("/", verifyToken, productsController.getAll);
productosRouter.get("/:id", verifyToken, productsController.getById);

productosRouter.post(
  "/",
  verifyToken,
  requireRole(roleRequired),
  productsController.create
);
productosRouter.patch(
  "/:id",
  verifyToken,
  requireRole(roleRequired),
  productsController.edit
);
productosRouter.delete(
  "/:id",
  verifyToken,
  requireRole(roleRequired),
  productsController.delete
);
