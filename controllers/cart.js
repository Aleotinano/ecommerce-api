import { CartModel } from "../services/cart.js";

export class cartController {
  static async getCart(req, res, next) {
    try {
      const { id } = req.user;
      const cart = await CartModel.getCart({ id });

      return res.json({
        message: "Tu carrito de compras",
        cart: {
          created: cart.createdAt,
          updated: cart.updatedAt,
        },
        products: cart.items.map((item) => ({
          variant: {
            id: item.variant.id,
            color: item.variant.color,
            size: item.variant.size,
            price: item.variant.price,
            stock: item.variant.stock,
            sku: item.variant.sku,
            img: item.variant.img ?? item.variant.product?.img ?? null,
            product: item.variant.product
              ? {
                  id: item.variant.product.id,
                  name: item.variant.product.name,
                  img: item.variant.product.img,
                }
              : null,
          },
          quantity: item.quantity,
        })),
      });
    } catch (error) {
      next(error);
    }
  }

  static async add(req, res, next) {
    try {
      const { id } = req.user;
      const variantId = req.params.variantId;

      const cartItem = await CartModel.add({ id, variantId });

      return res.status(201).json({
        message: "Variante agregada al carrito",
        data: {
          producto: cartItem.variant.product?.name,
          variant: {
            id: cartItem.variant.id,
            color: cartItem.variant.color,
            size: cartItem.variant.size,
            sku: cartItem.variant.sku,
          },
          cantidad: cartItem.quantity,
          stockRestante: cartItem.variant.stock - cartItem.quantity,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async remove(req, res, next) {
    try {
      const { id } = req.user;
      const variantId = req.params.variantId;

      const result = await CartModel.remove({ id, variantId });

      if (result.deleted) {
        return res.json({ message: "Variante eliminada del carrito" });
      }

      return res.json({
        message: "Cantidad reducida en 1",
        cantidadRestante: result.cartItem.quantity,
      });
    } catch (error) {
      next(error);
    }
  }

  static async clear(req, res, next) {
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
