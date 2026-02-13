import prisma from "../lib/prisma.js";
import { createError } from "../helpers/error.js";

export const CartModel = {
  async getCart({ id }) {
    const cart = await prisma.cart.findUnique({
      where: { userId: id },
      include: {
        items: {
          include: { product: true },
        },
      },
    });

    if (!cart || !cart.items || cart.items.length === 0) {
      throw createError("El carrito esta vacio", "EMPTY_CART", 404);
    }

    return cart;
  },

  async add({ id, productId }) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      throw createError("Producto no encontrado", "PRODUCT_NOT_FOUND", 404);
    }

    if (!product.isActive) {
      throw createError("Producto no disponible", "PRODUCT_NOT_FOUND", 404);
    }

    const cart = await prisma.cart.upsert({
      where: { userId: id },
      update: {},
      create: { userId: id },
    });

    const existingCartItem = await prisma.cartItem.findUnique({
      where: {
        cartId_productId: {
          cartId: cart.id,
          productId: productId,
        },
      },
    });

    const currentQuantity = existingCartItem?.quantity || 0;

    if (currentQuantity + 1 > product.stock) {
      throw createError("Stock insuficiente", "INSUFFICIENT_STOCK", 409);
    }

    const productAdded = await prisma.cartItem.upsert({
      where: {
        cartId_productId: {
          cartId: cart.id,
          productId: productId,
        },
      },
      update: {
        quantity: { increment: 1 },
      },
      create: {
        cartId: cart.id,
        productId: productId,
        quantity: 1,
      },
      include: {
        product: true,
      },
    });

    return productAdded;
  },

  async remove({ id, productId }) {
    const cart = await prisma.cart.findUnique({
      where: { userId: id },
    });

    if (!cart || !cart.items || cart.items.length === 0) {
      throw createError("El carrito esta vacio", "EMPTY_CART", 404);
    }

    const cartItem = await prisma.cartItem.findUnique({
      where: {
        cartId_productId: {
          cartId: cart.id,
          productId: productId,
        },
      },
    });

    if (!cartItem) {
      throw createError("No se encontró el producto", "PRODUCT_NOT_FOUND", 404);
    }

    if (cartItem.quantity === 1) {
      await prisma.cartItem.delete({
        where: {
          cartId_productId: {
            cartId: cart.id,
            productId: productId,
          },
        },
      });

      return { deleted: true };
    }

    const updated = await prisma.cartItem.update({
      where: {
        cartId_productId: {
          cartId: cart.id,
          productId: productId,
        },
      },
      data: {
        quantity: { decrement: 1 },
      },
      include: {
        product: true,
      },
    });

    return { deleted: false, cartItem: updated };
  },

  async clear({ id }) {
    const cart = await prisma.cart.findUnique({
      where: { userId: id },
    });

    if (!cart) {
      throw createError("El carrito esta vacio", "EMPTY_CART", 404);
    }

    const deleted = await prisma.cartItem.deleteMany({
      where: {
        cartId: cart.id,
      },
    });

    return deleted;
  },
};
