import { Router } from "express";
import { categoriesController } from "../controllers/categories.js";
import { verifyToken } from "../middleware/auth.js";
import { requireRole } from "../middleware/role.js";
import { validate } from "../middleware/validate.js";
import { createCategory, updateCategory } from "../schemas/category.schema.js";
import { validateId } from "../schemas/id.schema.js";

export const categoriesRouter = Router();

const roleRequired = "ADMIN";

const validation = {
  create: validate({ body: createCategory }),
  update: validate({ body: updateCategory, params: validateId }),
  id: validate({ params: validateId }),
};

categoriesRouter.get("/", categoriesController.getAll);

categoriesRouter.get("/tree", categoriesController.getTree);

categoriesRouter.get("/:id", validation.id, categoriesController.getById);

categoriesRouter.post(
  "/",
  verifyToken,
  requireRole(roleRequired),
  validation.create,
  categoriesController.create
);

categoriesRouter.patch(
  "/:id",
  verifyToken,
  requireRole(roleRequired),
  validation.update,
  categoriesController.edit
);

categoriesRouter.delete(
  "/:id",
  verifyToken,
  requireRole(roleRequired),
  validation.id,
  categoriesController.delete
);