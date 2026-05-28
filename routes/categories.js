import { Router } from "express";
import { CategoryController } from "../controllers/categories.js";
import { verifyToken } from "../middleware/auth.js";
import { requireRole } from "../middleware/role.js";
import { validate } from "../middleware/validate.js";
import { createCategory, updateCategory } from "../schemas/category.schema.js";
import { validateId } from "../schemas/id.schema.js";

export const categoriesRouter = Router();

const roleRequired = ["ADMIN", "STAFF"];

const validation = {
  create: validate({ body: createCategory }),
  update: validate({ body: updateCategory, params: validateId }),
  id: validate({ params: validateId }),
};

categoriesRouter.get("/", verifyToken, CategoryController.getAll);

categoriesRouter.get("/tree", verifyToken, CategoryController.getTree);

categoriesRouter.get(
  "/:id",
  verifyToken,
  validation.id,
  CategoryController.getById
);

categoriesRouter.post(
  "/",
  verifyToken,
  requireRole(roleRequired),
  validation.create,
  CategoryController.create
);

categoriesRouter.patch(
  "/:id",
  verifyToken,
  requireRole(roleRequired),
  validation.update,
  CategoryController.edit
);

categoriesRouter.delete(
  "/:id",
  verifyToken,
  requireRole(roleRequired),
  validation.id,
  CategoryController.delete
);
