import { CategoryModel } from "../../services/categories.js";

export class StoreCategoriesController {
  static async getAll(req, res, next) {
    try {
      const includeChildren = req.query.includeChildren === "true";
      const categories = await CategoryModel.getAll({
        tenantId: req.tenantId,
        includeChildren,
      });
      res.json(categories);
    } catch (error) {
      next(error);
    }
  }

  static async getTree(req, res, next) {
    try {
      const categories = await CategoryModel.getTree({
        tenantId: req.tenantId,
      });
      res.json(categories);
    } catch (error) {
      next(error);
    }
  }

  static async getById(req, res, next) {
    try {
      const { id } = req.params;
      const category = await CategoryModel.getById({
        tenantId: req.tenantId,
        id,
      });
      res.json(category);
    } catch (error) {
      next(error);
    }
  }
}
