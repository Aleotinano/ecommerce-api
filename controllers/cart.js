import { CartModel } from "../services/cart.js";
import { getProductPrice, resolveProductStock } from "../helpers/price.js";

// Este controller es compartido por /cart (admin, exige login vía verifyToken, sin
// req.cartOwner) y /store/cart (storefront, admite guest vía resolveCartOwner). El
// fallback cubre el caso admin, siempre con userId.
function resolveOwner(req) {
  return req.cartOwner ?? { userId: req.user.id, guestId: null };
}

export class cartController {
  static async getCart(req, res, next) {
    try {
      const { userId, guestId } = resolveOwner(req);
      const cart = await CartModel.getCart({ tenantId: req.tenantId, userId, guestId });

      return res.json({
        message: "Tu carrito de compras",
        cart: {
          created: cart.createdAt,
          updated: cart.updatedAt,
        },
        products: cart.items.map((item) => ({
          product: item.product
            ? {
                id: item.product.id,
                name: item.product.name,
                type: item.product.type,
                img: item.product.img,
              }
            : null,
          variant: item.variant
            ? {
                id: item.variant.id,
                attributes: item.variant.attributes,
                sku: item.variant.sku,
              }
            : null,
          price: getProductPrice(item.variant, item.product),
          stock: resolveProductStock(item.product, item.variant),
          img: item.variant?.img ?? item.product?.img ?? null,
          quantity: item.quantity,
          comboSelection: item.comboSelection ?? null,
        })),
      });
    } catch (error) {
      next(error);
    }
  }

  static async addCombo(req, res, next) {
    try {
      const { userId, guestId } = resolveOwner(req);
      const productId = req.params.productId;
      const { selection } = req.body;

      const cartItem = await CartModel.addCombo({
        tenantId: req.tenantId,
        userId,
        guestId,
        comboProductId: productId,
        selection,
      });

      return res.status(201).json({
        message: "Combo agregado al carrito",
        data: {
          producto: cartItem.product?.name,
          productId: cartItem.productId,
          cantidad: cartItem.quantity,
          seleccion: cartItem.comboSelection,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async add(req, res, next) {
    try {
      const { userId, guestId } = resolveOwner(req);
      const productId = req.params.productId;
      const { variantId } = req.body ?? {};

      const cartItem = await CartModel.add({
        tenantId: req.tenantId,
        userId,
        guestId,
        productId,
        variantId,
      });

      const stock = resolveProductStock(cartItem.product, cartItem.variant);

      return res.status(201).json({
        message: "Producto agregado al carrito",
        data: {
          producto: cartItem.product?.name,
          variant: cartItem.variant
            ? {
                id: cartItem.variant.id,
                attributes: cartItem.variant.attributes,
                sku: cartItem.variant.sku,
              }
            : null,
          cantidad: cartItem.quantity,
          stockRestante: stock != null ? stock - cartItem.quantity : null,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async remove(req, res, next) {
    try {
      const { userId, guestId } = resolveOwner(req);
      const productId = req.params.productId;
      const { variantId } = req.body ?? {};

      const result = await CartModel.remove({
        tenantId: req.tenantId,
        userId,
        guestId,
        productId,
        variantId,
      });

      if (result.deleted) {
        return res.json({ message: "Producto eliminado del carrito" });
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
      const { userId, guestId } = resolveOwner(req);
      const result = await CartModel.clear({ tenantId: req.tenantId, userId, guestId });

      return res.json({
        message: "Carrito vaciado completamente",
        productosEliminados: result.count,
      });
    } catch (error) {
      next(error);
    }
  }
}
