import { Router } from "express";
import { OrderController } from "../controllers/orders.js";
import { verifyToken } from "../middleware/auth.js";
import { requireRole } from "../middleware/role.js";
import { validate } from "../middleware/validate.js";
import {
  orderStatus,
  orderQuery,
  orderReview,
  orderConfirmDeposit,
  orderConfirmTransfer,
  orderCreate,
} from "../schemas/order.schema.js";
import { validateId } from "../schemas/id.schema.js";

export const ordersRouter = Router();

const roleRequired = ["ADMIN", "STAFF"];

const validation = {
  id: validate({ params: validateId }),
  create: validate({ body: orderCreate }),
  update: validate({ body: orderStatus }),
  review: validate({ body: orderReview }),
  confirmDeposit: validate({ body: orderConfirmDeposit }),
  confirmTransfer: validate({ body: orderConfirmTransfer }),
  query: validate({ query: orderQuery }),
};

// Crear orden con el carrito
ordersRouter.post("/", verifyToken, validation.create, OrderController.create);

// Obtener todas órdenes de usuario
ordersRouter.get("/", verifyToken, validation.query, OrderController.getAll);

// Obtener todas las órdenes
ordersRouter.get(
  "/all",
  verifyToken,
  requireRole(roleRequired),
  validation.query,
  OrderController.getUserOrders
);

// Obtener una orden específica del usuario
ordersRouter.get("/:id", verifyToken, validation.id, OrderController.getById);

// Actualizar el status de una orden
ordersRouter.patch(
  "/:id",
  verifyToken,
  requireRole(roleRequired),
  validation.id,
  validation.update,
  OrderController.update
);

// Revisar/validar un pedido (procedencia BOT) — corrección inline opcional
ordersRouter.post(
  "/:id/review",
  verifyToken,
  requireRole(roleRequired),
  validation.id,
  validation.review,
  OrderController.review
);

// Confirmar la seña de un pedido (el dueño verificó la transferencia)
ordersRouter.post(
  "/:id/confirm-deposit",
  verifyToken,
  requireRole(roleRequired),
  validation.id,
  validation.confirmDeposit,
  OrderController.confirmDeposit
);

// Confirmar que la transferencia del pago llegó (revisión manual, no automática)
ordersRouter.post(
  "/:id/confirm-transfer",
  verifyToken,
  requireRole(roleRequired),
  validation.id,
  validation.confirmTransfer,
  OrderController.confirmTransfer
);
