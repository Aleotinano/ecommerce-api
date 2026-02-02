import { CategoryModel } from "../services/categories.js";

export class categoriesController {
  static async getAll(req, res) {
    const categories = await CategoryModel.getAll();
    res.json({ message: "categorías disponibles:", categories });
  }

  static async getById(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        res.status(404).json({ error: "El producto no existe" });
      }

      const category = await CategoryModel.getById({ id });
      res.json({ message: "categoría", category });
    } catch (error) {
      res.status(500).json({ error: "Producto no encontrado" });
    }
  }

  static async create(req, res) {
    try {
      const { name, description, isActive, icon } = req.body;

      if (!name) {
        return res.status(400).json({
          message: "El nombre es obligatorio",
        });
      }

      const category = await CategoryModel.create({
        name,
        description,
        isActive,
        icon,
      });

      res.status(201).json({
        message: "Categoría creada",
        category,
      });
    } catch (error) {
      if (error.message === "CATEGORY_ALREADY_EXISTS") {
        return res.status(409).json({
          message: "La categoría ya existe",
        });
      }
      console.error(error);
      res.status(500).json({ message: "Error al crear la categoría" });
    }
  }

  static async edit(req, res) {
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

      if (category === null) {
        return res.status(404).json({
          message: "La categoría no existe",
        });
      }

      res.json({ message: "Categoría editada", category });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error al editar categoría" });
    }
  }

  static async delete(req, res) {
    try {
      const { id } = req.params;

      const category = await CategoryModel.delete({ id });

      if (!category) {
        return res.status(404).json({ error: "El producto no existe" });
      }

      res.json({ message: "Categoría eliminada", category });
    } catch (error) {
      if (error.message === "CATEGORY_HAS_PRODUCTS") {
        return res.status(400).json({
          message:
            "No puedes eliminar una categoría que tiene productos asociados",
        });
      }
      res.status(500).json({ message: "Error al eliminar la categoría" });
    }
  }
}
