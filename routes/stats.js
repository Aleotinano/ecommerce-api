import { Router } from "express";
import { StatsController } from "../controllers/stats.js";
import { verifyToken } from "../middleware/auth.js";
import { requireRole } from "../middleware/role.js";
import { validate } from "../middleware/validate.js";
import { StatsQuery } from "../schemas/stats.schema.js";

export const statsRouter = Router();

const roleRequired = ["ADMIN"];

statsRouter.get(
  "/dashboard",
  verifyToken,
  requireRole(roleRequired),
  validate({ query: StatsQuery }),
  StatsController.get
);
