import { CategoryModel } from "../services/categories.js";

export class CategoryController {
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
      const categories = await CategoryModel.getTree({ tenantId: req.tenantId });
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

      res.json({ message: "categoria", category: category });
    } catch (error) {
      next(error);
    }
  }

  static async create(req, res, next) {
    try {
      const { name, description, isActive, icon, imageUrl, parentId } = req.body;

      const category = await CategoryModel.create({
        tenantId: req.tenantId,
        name,
        description,
        isActive,
        icon,
        imageUrl,
        parentId,
      });

      res.status(201).json({
        message: "Categoria creada",
        category: category,
      });
    } catch (error) {
      next(error);
    }
  }

  static async edit(req, res, next) {
    try {
      const { id } = req.params;
      const { name, description, isActive, icon, imageUrl, parentId } = req.body;

      const category = await CategoryModel.edit({
        tenantId: req.tenantId,
        id,
        name,
        description,
        isActive,
        icon,
        imageUrl,
        parentId,
      });

      res.json({ message: "Categoria editada", category: category });
    } catch (error) {
      next(error);
    }
  }

  static async delete(req, res, next) {
    try {
      const { id } = req.params;

      const category = await CategoryModel.delete({
        tenantId: req.tenantId,
        id,
      });
      res.json({ message: "Categoria eliminada", category });
    } catch (error) {
      next(error);
    }
  }
}
