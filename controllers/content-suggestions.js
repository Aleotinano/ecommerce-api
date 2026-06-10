import { ContentSuggestionModel } from "../services/content-suggestions/index.js";

export class ContentSuggestionController {
  static async getToday(req, res, next) {
    try {
      const suggestion = await ContentSuggestionModel.getToday({
        tenantId: req.tenantId,
      });

      return res.json({
        message: "Sugerencia del dia obtenida correctamente",
        suggestion,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getRange(req, res, next) {
    try {
      const { range } = req.search;

      const data = await ContentSuggestionModel.getRange({
        tenantId: req.tenantId,
        range,
      });

      return res.json({
        message: "Timeline de sugerencias obtenida correctamente",
        ...data,
      });
    } catch (error) {
      next(error);
    }
  }
}
