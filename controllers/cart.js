import { CartModel } from "../services/cart.js";

export class cartController {
  static async getCart(req, res) {
    try {
      const { id } = req.user;

      const cart = await CartModel.getCart({ id });

      const cartInfo = {
        created: cart.createdAt,
        update: cart.updatedAt,
      };

      const productsInCart = cart.items.map((i) => ({
        product: i.product,
        quantity: i.quantity,
      }));

      if (!cart) {
        return res
          .status(400)
          .json({ message: "No hay productos en el carro" });
      }
      return res.json({ Cart: cartInfo, products: productsInCart });
    } catch (error) {
      return res.status(500).json({ message: "Error al cargar carro" });
    }
  }

  static async add(req, res) {
    try {
      const { productId } = req.params;
      const { id } = req.user;

      const cartItem = await CartModel.add({ id, productId });

      const quantity = cartItem.quantity;
      const stock = cartItem.product.stock;

      const info = {
        producto: cartItem.product.name,
        stock: stock,
        quantity: quantity,
      };

      if (quantity > stock) {
        return res.status(400).json({ message: "Producto sin stock", info });
      }

      return res.status(201).json({
        message: "Producto agregado al carro",
        data: cartItem,
      });
    } catch (error) {
      return res.status(500).json({
        message: "Error al agregar producto",
      });
    }
  }

  static async remove(req, res) {
    try {
      const { productId } = req.params;
      const { id } = req.user;

      const product = await CartModel.remove({ id, productId });

      if (product.deleted) {
        return res.json({
          message: "Producto eliminado del carrito",
        });
      }

      const quantity = Number(product.cartItem.quantity);

      if (!quantity) {
        return res.json({
          message: "No hay productos en el carro",
        });
      }

      return res.json({
        message: "Producto quitado",
        quantity: quantity,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        message: "Error al eliminar producto",
      });
    }
  }

  static async clear(req, res) {
    const { productId } = req.params;
    const { id } = req.user;

    const product = await CartModel.clear({ id, productId });

    if (product.count === 0) {
      return res
        .status(404)
        .json({ message: "Producto no encontrado en el carrito" });
    }

    return res.json({ message: "Producto eliminado del carrito" });
  }
}
