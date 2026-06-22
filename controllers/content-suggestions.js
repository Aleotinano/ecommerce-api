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

  static async getProductAngles(req, res, next) {
    try {
      const data = await ContentSuggestionModel.getProductAngles({
        tenantId: req.tenantId,
        productId: req.params.productId,
      });

      return res.json({
        message: "Angulos disponibles para el producto",
        ...data,
      });
    } catch (error) {
      next(error);
    }
  }

  static async generateForProduct(req, res, next) {
    try {
      const suggestion = await ContentSuggestionModel.generateForProduct({
        tenantId: req.tenantId,
        productId: req.params.productId,
        angle: req.body.angle,
      });

      return res.json({
        message: "Copy generado correctamente",
        suggestion,
      });
    } catch (error) {
      next(error);
    }
  }

  static async refineProductCopy(req, res, next) {
    try {
      const variation = await ContentSuggestionModel.refineProductCopy({
        tenantId: req.tenantId,
        productId: req.body.productId,
        angle: req.body.angle,
        mode: req.body.mode,
        instruction: req.body.instruction,
        baseCopy: req.body.baseCopy,
        baseHashtags: req.body.baseHashtags,
      });

      return res.json({
        message: "Variacion generada correctamente",
        variation,
      });
    } catch (error) {
      next(error);
    }
  }
}
