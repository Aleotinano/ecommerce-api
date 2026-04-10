import { Router } from "express";
import { roleController } from "../controllers/role.js";
import { requireRole } from "../middleware/role.js";
import { verifyToken } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { validateId } from "../schemas/id.schema.js";
import { updateRoleSchema } from "../schemas/role.schema.js";

export const roleRouter = Router();

const roleRequired = ["ADMIN"];

const validation = {
  edit: validate({ params: validateId, body: updateRoleSchema }),
};

roleRouter.patch(
  "/:id",
  verifyToken,
  requireRole(roleRequired),
  validation.edit,
  roleController.edit
);
