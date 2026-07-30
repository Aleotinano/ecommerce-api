import { Router } from "express";
import { CashRegisterController } from "../controllers/cash-register.js";
import { verifyToken } from "../middleware/auth.js";
import { requireRole } from "../middleware/role.js";
import { validate } from "../middleware/validate.js";
import {
  cashCategoryQuery,
  cashSessionQuery,
  cashSummaryQuery,
  closeCashSession,
  createCashCategory,
  createCashMovement,
  openCashSession,
  updateCashCategory,
} from "../schemas/cash-register.schema.js";
import { validateId } from "../schemas/id.schema.js";

export const cashRegisterRouter = Router();

// Operar la caja es backoffice: mismo criterio que el resto (`/promos`, `/stats`).
// El catálogo de etiquetas lo toca solo ADMIN — es configuración, no operación del
// turno.
const operarCaja = ["ADMIN", "STAFF"];
const configurarCaja = ["ADMIN"];

const validation = {
  open: validate({ body: openCashSession }),
  close: validate({ body: closeCashSession }),
  movement: validate({ body: createCashMovement }),
  sessionQuery: validate({ query: cashSessionQuery }),
  summaryQuery: validate({ query: cashSummaryQuery }),
  categoryQuery: validate({ query: cashCategoryQuery }),
  createCategory: validate({ body: createCashCategory }),
  updateCategory: validate({ params: validateId, body: updateCashCategory }),
  id: validate({ params: validateId }),
};

cashRegisterRouter.use(verifyToken);

// OJO con el orden: todas las rutas de nombre fijo van ANTES de `/:id`, o
// `validateId` rechaza "current"/"summary"/"categories" con un 400.
cashRegisterRouter.get(
  "/current",
  requireRole(operarCaja),
  CashRegisterController.current
);

cashRegisterRouter.post(
  "/open",
  requireRole(operarCaja),
  validation.open,
  CashRegisterController.open
);

cashRegisterRouter.post(
  "/close",
  requireRole(operarCaja),
  validation.close,
  CashRegisterController.close
);

cashRegisterRouter.post(
  "/movements",
  requireRole(operarCaja),
  validation.movement,
  CashRegisterController.addMovement
);

cashRegisterRouter.get(
  "/summary",
  requireRole(operarCaja),
  validation.summaryQuery,
  CashRegisterController.summary
);

// El período entero en una planilla ("el Excel de julio"). Antes de `/:id`.
cashRegisterRouter.get(
  "/export",
  requireRole(operarCaja),
  validation.summaryQuery,
  CashRegisterController.exportPeriod
);

cashRegisterRouter.get(
  "/categories",
  requireRole(operarCaja),
  validation.categoryQuery,
  CashRegisterController.listCategories
);

cashRegisterRouter.post(
  "/categories",
  requireRole(configurarCaja),
  validation.createCategory,
  CashRegisterController.createCategory
);

cashRegisterRouter.patch(
  "/categories/:id",
  requireRole(configurarCaja),
  validation.updateCategory,
  CashRegisterController.updateCategory
);

cashRegisterRouter.delete(
  "/categories/:id",
  requireRole(configurarCaja),
  validation.id,
  CashRegisterController.deleteCategory
);

cashRegisterRouter.get(
  "/",
  requireRole(operarCaja),
  validation.sessionQuery,
  CashRegisterController.getAll
);

cashRegisterRouter.get(
  "/:id",
  requireRole(operarCaja),
  validation.id,
  CashRegisterController.getById
);

// Descarga del turno en Excel (3 hojas: arqueo, movimientos, resumen).
cashRegisterRouter.get(
  "/:id/export",
  requireRole(operarCaja),
  validation.id,
  CashRegisterController.exportSession
);
