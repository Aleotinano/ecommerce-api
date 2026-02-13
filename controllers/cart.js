import { CartModel } from "../services/cart.js";

export class cartController {
  static async getCart(req, res) {
    try {
      const { id } = req.user;

      const cart = await CartModel.getCart({ id });

      const cartInfo = {
        created: cart.createdAt,
        updated: cart.updatedAt,
      };

      const productsInCart = cart.items.map((i) => ({
        product: i.product,
        quantity: i.quantity,
      }));

      return res.json({
        message: "Tu carrito de compras",
        cart: cartInfo,
        products: productsInCart,
      });
    } catch (error) {
      next(error);
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
      next(error);
    }
  }

  static async remove(req, res) {
    try {
      const { productId } = req.params;
      const { id } = req.user;

      const result = await CartModel.remove({ id, productId });

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
      next(error);
    }
  }

  static async clear(req, res) {
    try {
      const { id } = req.user;
      const result = await CartModel.clear({ id });

      return res.json({
        message: "Carrito vaciado completamente",
        productosEliminados: result.count,
      });
    } catch (error) {
      next(error);
    }
  }
}
