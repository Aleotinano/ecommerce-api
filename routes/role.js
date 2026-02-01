import { Router } from "express";
import { roleController } from "../controllers/role.js";
import { requireRole } from "../middleware/role.js";
import { verifyToken } from "../middleware/auth.js";

export const roleRouter = Router();

const roleRequired = ["ADMIN"];

roleRouter.patch(
  "/:id",
  verifyToken,
  requireRole(roleRequired),
  roleController.edit
);
