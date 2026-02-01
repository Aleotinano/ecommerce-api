import { Router } from "express";
import { categoriesController } from "../controllers/categories.js";
import { verifyToken } from "../middleware/auth.js";
import { requireRole } from "../middleware/role.js";

export const categoriesRouter = Router();

const roleRequired = "ADMIN";

categoriesRouter.get("/", verifyToken, categoriesController.getAll);

categoriesRouter.post(
  "/",
  requireRole(roleRequired),
  verifyToken,
  categoriesController.create
);

categoriesRouter.patch(
  "/:id",
  requireRole(roleRequired),
  verifyToken,
  categoriesController.edit
);

categoriesRouter.delete(
  "/:id",
  requireRole(roleRequired),
  verifyToken,
  categoriesController.delete
);
