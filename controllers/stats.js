import { StatsModel } from "../services/stats.js";

export class StatsController {
  static async get(req, res, next) {
    try {
      const { days, lowStockThreshold } = req.search;

      const dashboard = await StatsModel.getDashboard({
        tenantId: req.tenantId,
        days,
        lowStockThreshold,
      });

      return res.json({
        message: "Estadisticas obtenidas correctamente",
        dashboard,
      });
    } catch (error) {
      next(error);
    }
  }
}
