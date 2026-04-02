import { CategoryModel } from "../services/categories.js";

export class CategoryController {
  static async getAll(req, res, next) {
    try {
      const includeChildren = req.query.includeChildren === "true";
      const categories = await CategoryModel.getAll({ includeChildren });
      res.json(categories);
    } catch (error) {
      next(error);
    }
  }

  static async getTree(req, res, next) {
    try {
      const categories = await CategoryModel.getTree();
      res.json(categories);
    } catch (error) {
      next(error);
    }
  }

  static async getById(req, res, next) {
    try {
      const { id } = req.params;
      const category = await CategoryModel.getById({ id });

      res.json({ message: "categoria", category: category });
    } catch (error) {
      next(error);
    }
  }

  static async create(req, res, next) {
    try {
      const { name, description, isActive, icon, parentId } = req.body;

      const category = await CategoryModel.create({
        name,
        description,
        isActive,
        icon,
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
      const { name, description, isActive, icon, parentId } = req.body;

      const category = await CategoryModel.edit({
        id,
        name,
        description,
        isActive,
        icon,
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

      const category = await CategoryModel.delete({ id });
      res.json({ message: "Categoria eliminada", category });
    } catch (error) {
      next(error);
    }
  }
}
