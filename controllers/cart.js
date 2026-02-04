import { CartModel } from "../services/cart.js";

export class cartController {
  static async getCart(req, res) {
    try {
      const { id } = req.user;

      const cart = await CartModel.getCart({ id });

      if (!cart || !cart.items || cart.items.length === 0) {
        return res.status(404).json({
          message: "No hay productos en el carrito",
        });
      }

      const cartInfo = {
        created: cart.createdAt,
        updated: cart.updatedAt,
      };

      const productsInCart = cart.items.map((i) => ({
        product: i.product,
        quantity: i.quantity,
      }));

      return res.json({ cart: cartInfo, products: productsInCart });
    } catch (error) {
      return res.status(500).json({
        message: "Error al cargar carrito",
      });
    }
  }

  static async add(req, res) {
    try {
      const { productId } = req.params;
      const { id } = req.user;

      const cartItem = await CartModel.add({ id, productId });

      const { quantity } = cartItem;
      const { stock } = cartItem.product;

      return res.status(201).json({
        message: "Producto agregado al carrito",
        data: {
          producto: cartItem.product.name,
          cantidad: quantity,
          stockRestante: stock - quantity,
        },
      });
    } catch (error) {
      switch (error.code) {
        case "PRODUCT_NOT_FOUND":
          return res.status(404).json({
            message: "Producto no encontrado o no disponible",
          });

        case "INSUFFICIENT_STOCK":
          return res.status(400).json({
            message: "Stock insuficiente",
            data: error.details,
          });

        default:
          return res.status(500).json({
            message: "Error al agregar producto",
          });
      }
    }
  }

  static async remove(req, res) {
    try {
      const { productId } = req.params;
      const { id } = req.user;

      const result = await CartModel.remove({ id, productId });

      if (!result) {
        return res.status(404).json({
          message: "Producto no encontrado en el carrito",
        });
      }

      if (result.deleted) {
        return res.json({
          message: "Producto eliminado del carrito completamente",
        });
      }

      const quantity = result.cartItem.quantity;

      return res.json({
        message: "Cantidad reducida en 1",
        cantidadRestante: quantity,
      });
    } catch (error) {
      return res.status(500).json({
        message: "Error al eliminar producto",
      });
    }
  }

  static async clear(req, res) {
    try {
      const { id } = req.user;

      const result = await CartModel.clear({ id });

      if (!result || result.count === 0) {
        return res.status(404).json({
          message: "El carrito ya está vacío",
        });
      }

      return res.json({
        message: "Carrito vaciado completamente",
        productosEliminados: result.count,
      });
    } catch (error) {
      return res.status(500).json({
        message: "Error al vaciar carrito",
      });
    }
  }
}
