import { CategoryModel } from "../services/categories.js";

export class categoriesController {
  static async getAll(req, res, next) {
    try {
      const categories = await CategoryModel.getAll();
      res.json(categories);
    } catch (error) {
      next(error);
    }
  }

  static async getById(req, res, next) {
    try {
      const { id } = req.params;
      const category = await CategoryModel.getById({ id });

      res.json({ message: "categoría", category: category });
    } catch (error) {
      next(error);
    }
  }

  static async create(req, res, next) {
    try {
      const { name, description, isActive, icon } = req.body;

      const category = await CategoryModel.create({
        name,
        description,
        isActive,
        icon,
      });

      res.status(201).json({
        message: "Categoría creada",
        category: category,
      });
    } catch (error) {
      next(error);
    }
  }

  static async edit(req, res, next) {
    try {
      const { id } = req.params;
      const { name, description, isActive, icon } = req.body;

      const category = await CategoryModel.edit({
        id,
        name,
        description,
        isActive,
        icon,
      });

      res.json({ message: "Categoría editada", category: category });
    } catch (error) {
      next(error);
    }
  }

  static async delete(req, res) {
    try {
      const { id } = req.params;

      const category = await CategoryModel.delete({ id });
      res.json({ message: "Categoría eliminada", category });
    } catch (error) {
      next(error);
    }
  }
}
