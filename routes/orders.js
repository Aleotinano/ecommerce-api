import { Router } from "express";
import { OrderController } from "../controllers/orders.js";
import { verifyToken } from "../middleware/auth.js";
import { requireRole } from "../middleware/role.js";
import { validate } from "../middleware/validate.js";
import { orderStatus } from "../schemas/order.schema.js";
import { validateId } from "../schemas/id.schema.js";

export const ordersRouter = Router();

const roleRequired = "ADMIN";

const validation = {
  id: validate({ params: validateId }),
  update: validate({ body: orderStatus }),
};

// Crear orden con el carrito
ordersRouter.post("/", verifyToken, OrderController.create);

// Obtener todas órdenes de usuario
ordersRouter.get("/", verifyToken, OrderController.getAll);

// Obtener una orden específica del usuario
ordersRouter.get("/:id", verifyToken, validation.id, OrderController.getById);

// Obtener todas las órdenes
ordersRouter.get(
  "/all",
  verifyToken,
  requireRole(roleRequired),
  OrderController.getUserOrders
);

// Actualizar el status de una orden
ordersRouter.patch(
  "/:id",
  verifyToken,
  requireRole(roleRequired),
  validation.id,
  validation.update,
  OrderController.update
);
