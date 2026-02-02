import { ProductModel } from "../services/productos.js";

export class productsController {
  static async getAll(req, res) {
    const { name, price, limit, offset } = req.search;

    const pagination = await ProductModel.getAll({
      name,
      price,
      limit,
      offset,
    });

    return res.json(pagination);
  }

  static async getById(req, res) {
    const { id } = req.params;
    const product = await ProductModel.getById({ id });

    if (!product) {
      return res.status(404).json({
        error: "El producto no existe",
      });
    }

    return res.json(product);
  }

  static async create(req, res) {
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
  }

  static async edit(req, res) {
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

      if (!updatedProduct) {
        return res.status(404).json({
          error: "Producto no encontrado",
        });
      }

      return res.json({
        message: "Producto actualizado",
        product: updatedProduct,
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  static async delete(req, res) {
    try {
      const { id } = req.params;
      const deletedProduct = await ProductModel.delete({ id });

      if (!deletedProduct) {
        return res.status(404).json({ error: "Producto no encontrado" });
      }

      return res.json({
        message: "Producto eliminado correctamente",
        product: deletedProduct,
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }
}
