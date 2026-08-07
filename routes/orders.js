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
  orderConfirmPayment,
  orderPaymentCreate,
  orderReceiptCreate,
  orderReceiptParams,
  orderCreate,
  orderExportQuery,
} from "../schemas/order.schema.js";
import { validateId } from "../schemas/id.schema.js";
import { uploadReceipt, normalizeMultipartBody } from "../middleware/upload.js";

export const ordersRouter = Router();

const roleRequired = ["ADMIN", "STAFF"];

const validation = {
  id: validate({ params: validateId }),
  create: validate({ body: orderCreate }),
  update: validate({ body: orderStatus }),
  review: validate({ body: orderReview }),
  confirmDeposit: validate({ body: orderConfirmDeposit }),
  confirmTransfer: validate({ body: orderConfirmTransfer }),
  confirmPayment: validate({ body: orderConfirmPayment }),
  payment: validate({ body: orderPaymentCreate }),
  receipt: validate({ body: orderReceiptCreate }),
  receiptParams: validate({ params: orderReceiptParams }),
  query: validate({ query: orderQuery }),
  exportQuery: validate({ query: orderExportQuery }),
};

// Subida de comprobante: multer + verificación del contenido real del archivo, y
// después el casteo de los campos de texto del multipart (llegan todos como
// string) para que Zod vea números y arrays, no `"5"` y `"[1,2]"`.
const receiptUpload = [uploadReceipt, normalizeMultipartBody];

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

// Cuántas órdenes hay por estado (encabezados del tablero del admin).
// Va ANTES de "/:id": si no, la toma la ruta de detalle y muere en validateId.
ordersRouter.get(
  "/counts",
  verifyToken,
  requireRole(roleRequired),
  validation.query,
  OrderController.getStatusCounts
);

// Las órdenes del rango en una planilla ("el Excel de hoy"). Como `/counts`, va
// ANTES de "/:id": si no, la toma la ruta de detalle y muere en validateId.
ordersRouter.get(
  "/export",
  verifyToken,
  requireRole(roleRequired),
  validation.exportQuery,
  OrderController.exportOrders
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

// Confirmar que la transferencia del pago llegó (revisión manual, no automática).
// Acepta el comprobante en el mismo request (multipart, campo `receipt`) para que
// quien ya decidió confirme y adjunte de una; con JSON puro funciona igual que
// siempre.
ordersRouter.post(
  "/:id/confirm-transfer",
  verifyToken,
  requireRole(roleRequired),
  receiptUpload,
  validation.id,
  validation.confirmTransfer,
  OrderController.confirmTransfer
);

// Comprobantes de la transferencia: el archivo que se miró para dar el cobro por
// bueno. Adjuntar NO confirma nada — son dos actos distintos a propósito, ver
// services/order-receipts.js.
ordersRouter.post(
  "/:id/receipts",
  verifyToken,
  requireRole(roleRequired),
  receiptUpload,
  validation.id,
  validation.receipt,
  OrderController.addReceipt
);

ordersRouter.get(
  "/:id/receipts",
  verifyToken,
  requireRole(roleRequired),
  validation.id,
  OrderController.getReceipts
);

// Borrar es solo de ADMIN: no es una corrección cosmética, saca del proveedor un
// archivo que quizá alguien ya usó para confirmar un cobro.
ordersRouter.delete(
  "/:id/receipts/:receiptId",
  verifyToken,
  requireRole(["ADMIN"]),
  validation.receiptParams,
  OrderController.removeReceipt
);

// Dar por cobrado el total de la orden → paymentStatus = PAID_IN_FULL
ordersRouter.post(
  "/:id/confirm-payment",
  verifyToken,
  requireRole(roleRequired),
  validation.id,
  validation.confirmPayment,
  OrderController.confirmPayment
);

// Libro de cobros de la orden: una fila por cobro, con vía y monto. Los tres
// confirm-* de arriba son atajos que escriben en este mismo libro.
ordersRouter.post(
  "/:id/payments",
  verifyToken,
  requireRole(roleRequired),
  validation.id,
  validation.payment,
  OrderController.registerPayment
);

ordersRouter.get(
  "/:id/payments",
  verifyToken,
  requireRole(roleRequired),
  validation.id,
  OrderController.getPayments
);
