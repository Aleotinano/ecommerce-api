import prisma from "../lib/prisma.js";
import { createError } from "../helpers/error.js";

export const CartModel = {
  async getCart({ tenantId, id }) {
    const cart = await prisma.cart.findFirst({
      where: { userId: id, tenantId },
      include: {
        items: {
          include: {
            variant: {
              include: { product: true },
            },
          },
        },
      },
    });

    if (!cart) {
      return { createdAt: null, updatedAt: null, items: [] };
    }

    return cart;
  },

  async add({ tenantId, id, variantId }) {
    return prisma.$transaction(async (tx) => {
      const variant = await tx.productVariant.findFirst({
        where: { id: variantId, tenantId },
        include: { product: true },
      });

      if (!variant) {
        throw createError("Variante no encontrada", "VARIANT_NOT_FOUND", 404);
      }

      if (!variant.isActive || !variant.product?.isActive) {
        throw createError(
          "Variante no disponible",
          "VARIANT_NOT_AVAILABLE",
          400
        );
      }

      const cart = await tx.cart.upsert({
        where: { userId: id },
        update: {},
        create: { userId: id, tenantId },
      });

      const existingItem = await tx.cartItem.findUnique({
        where: { cartId_variantId: { cartId: cart.id, variantId } },
      });

      const currentQuantity = existingItem?.quantity ?? 0;

      if (currentQuantity + 1 > variant.stock) {
        throw createError("Stock insuficiente", "INSUFFICIENT_STOCK", 409);
      }

      return tx.cartItem.upsert({
        where: { cartId_variantId: { cartId: cart.id, variantId } },
        update: { quantity: { increment: 1 } },
        create: { cartId: cart.id, variantId, quantity: 1 },
        include: {
          variant: { include: { product: true } },
        },
      });
    });
  },

  async remove({ tenantId, id, variantId }) {
    const cart = await prisma.cart.findFirst({
      where: { userId: id, tenantId },
      select: { id: true },
    });

    if (!cart) {
      throw createError("El carrito está vacío", "EMPTY_CART", 404);
    }

    const cartItem = await prisma.cartItem.findUnique({
      where: { cartId_variantId: { cartId: cart.id, variantId } },
    });

    if (!cartItem) {
      throw createError(
        "No se encontró la variante en el carrito",
        "VARIANT_NOT_IN_CART",
        404
      );
    }

    if (cartItem.quantity === 1) {
      await prisma.cartItem.delete({
        where: { cartId_variantId: { cartId: cart.id, variantId } },
      });

      return { deleted: true };
    }

    const updated = await prisma.cartItem.update({
      where: { cartId_variantId: { cartId: cart.id, variantId } },
      data: { quantity: { decrement: 1 } },
    });

    return { deleted: false, cartItem: updated };
  },

  async clear({ tenantId, id }) {
    const cart = await prisma.cart.findFirst({
      where: { userId: id, tenantId },
      select: { id: true },
    });

    if (!cart) {
      throw createError("El carrito está vacío", "EMPTY_CART", 404);
    }

    return prisma.cartItem.deleteMany({
      where: { cartId: cart.id },
    });
  },
};
