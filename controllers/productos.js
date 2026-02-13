import { ProductModel } from "../services/productos.js";

export class productsController {
  static async getAll(req, res, next) {
    try {
      const { name, price, limit, offset } = req.search;

      const pagination = await ProductModel.getAll({
        name,
        price,
        limit,
        offset,
      });

      return res.json(pagination);
    } catch (error) {
      next(error);
    }
  }

  static async getById(req, res, next) {
    try {
      const { id } = req.params;
      const product = await ProductModel.getById({ id });

      return res.json(product);
    } catch (error) {
      next(error);
    }
  }

  static async create(req, res, next) {
    try {
      const { name, description, price, stock, img } = req.body;

      const newProduct = await ProductModel.create({
        name,
        description,
        price,
        stock,
        img,
      });

      return res
        .status(201)
        .json({ message: "producto creado", producto: newProduct });
    } catch (error) {
      next(error);
    }
  }

  static async edit(req, res, next) {
    try {
      const { id } = req.params;
      const { name, description, price, stock, img } = req.body;

      const updatedProduct = await ProductModel.edit(
        { id },
        {
          name,
          description,
          price,
          stock,
          img,
        }
      );

      return res.json({
        message: "Producto actualizado",
        product: updatedProduct,
      });
    } catch (error) {
      next(error);
    }
  }

  static async delete(req, res, next) {
    try {
      const { id } = req.params;
      const deletedProduct = await ProductModel.delete({ id });

      return res.json({
        message: "Producto eliminado correctamente",
        product: deletedProduct,
      });
    } catch (error) {
      next(error);
    }
  }
}
