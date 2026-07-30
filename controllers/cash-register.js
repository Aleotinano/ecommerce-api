import { CashRegisterModel } from "../services/cash-register.js";

export class CashRegisterController {
  /**
   * `session: null` con 200 y no un 404: "no hay caja abierta" es un estado normal
   * de la operación que el panel tiene que poder pintar (con el botón de abrir),
   * no un error.
   */
  static async current(req, res, next) {
    try {
      const session = await CashRegisterModel.getCurrent({
        tenantId: req.tenantId,
        actorId: req.user.id,
      });
      return res.json({ session });
    } catch (error) {
      next(error);
    }
  }

  static async open(req, res, next) {
    try {
      const session = await CashRegisterModel.open({
        tenantId: req.tenantId,
        openedById: req.user.id,
        ...req.body,
      });
      return res.status(201).json({ message: "Caja abierta", session });
    } catch (error) {
      next(error);
    }
  }

  static async close(req, res, next) {
    try {
      const session = await CashRegisterModel.close({
        tenantId: req.tenantId,
        closedById: req.user.id,
        ...req.body,
      });
      return res.json({ message: "Caja cerrada", session });
    } catch (error) {
      next(error);
    }
  }

  static async addMovement(req, res, next) {
    try {
      const movement = await CashRegisterModel.addMovement({
        tenantId: req.tenantId,
        createdById: req.user.id,
        ...req.body,
      });
      return res.status(201).json({ message: "Movimiento registrado", movement });
    } catch (error) {
      next(error);
    }
  }

  static async summary(req, res, next) {
    try {
      const summary = await CashRegisterModel.getSummary({
        tenantId: req.tenantId,
        ...req.search,
      });
      return res.json(summary);
    } catch (error) {
      next(error);
    }
  }

  static async getAll(req, res, next) {
    try {
      const result = await CashRegisterModel.getAll({
        tenantId: req.tenantId,
        ...req.search,
      });
      return res.json(result);
    } catch (error) {
      next(error);
    }
  }

  static async getById(req, res, next) {
    try {
      const session = await CashRegisterModel.getById({
        tenantId: req.tenantId,
        id: req.params.id,
      });
      return res.json({ session });
    } catch (error) {
      next(error);
    }
  }

  /** Descarga de un turno en Excel. */
  static async exportSession(req, res, next) {
    try {
      const { buffer, filename } = await CashRegisterModel.exportSession({
        tenantId: req.tenantId,
        id: req.params.id,
      });

      return CashRegisterController.sendXlsx(res, buffer, filename);
    } catch (error) {
      next(error);
    }
  }

  /** El mes entero en una planilla: todos los turnos del rango con su detalle. */
  static async exportPeriod(req, res, next) {
    try {
      const { buffer, filename } = await CashRegisterModel.exportPeriod({
        tenantId: req.tenantId,
        ...req.search,
      });

      return CashRegisterController.sendXlsx(res, buffer, filename);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Responde un `.xlsx`. Se manda el buffer completo y no un stream: son decenas o
   * unos miles de filas, no un dataset — y así un error al armar la planilla sale
   * por el `errorHandler` normal en vez de cortar una respuesta a medio enviar.
   */
  static sendXlsx(res, buffer, filename) {
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    // El nombre del archivo lo necesita el front para mostrarlo (fetch + blob no
    // lee Content-Disposition sin exponerlo).
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

    return res.send(Buffer.from(buffer));
  }

  // ── Etiquetas ──────────────────────────────────────────────────────────────

  static async listCategories(req, res, next) {
    try {
      const categories = await CashRegisterModel.listCategories({
        tenantId: req.tenantId,
        includeInactive: req.search?.includeInactive,
      });
      return res.json({ categories });
    } catch (error) {
      next(error);
    }
  }

  static async createCategory(req, res, next) {
    try {
      const category = await CashRegisterModel.createCategory({
        tenantId: req.tenantId,
        ...req.body,
      });
      return res.status(201).json({ message: "Etiqueta creada", category });
    } catch (error) {
      next(error);
    }
  }

  static async updateCategory(req, res, next) {
    try {
      const category = await CashRegisterModel.updateCategory({
        tenantId: req.tenantId,
        id: req.params.id,
        ...req.body,
      });
      return res.json({ message: "Etiqueta actualizada", category });
    } catch (error) {
      next(error);
    }
  }

  static async deleteCategory(req, res, next) {
    try {
      await CashRegisterModel.deleteCategory({
        tenantId: req.tenantId,
        id: req.params.id,
      });
      return res.json({ message: "Etiqueta eliminada" });
    } catch (error) {
      next(error);
    }
  }
}
