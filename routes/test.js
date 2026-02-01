import { Router } from "express";
import { verifyToken } from "../middleware/auth.js";
import { requireRole } from "../middleware/role.js";

export const testRouter = Router();

const testValue = "ADMIN";

testRouter.get("/:id", verifyToken, requireRole(testValue), (req, res) => {
  const { id, username, role } = req.user;

  return res.json({
    message: "Acceso autorizado - Ruta de prueba admin",
    user: {
      id,
      username,
      role,
    },
    timestamp: new Date().toISOString(),
  });
});
