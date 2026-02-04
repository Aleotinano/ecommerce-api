import prisma from "../lib/prisma.js";

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

    return cart;
  },

  async add({ id, productId }) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      const error = new Error("Producto no encontrado");
      error.code = "PRODUCT_NOT_FOUND";
      throw error;
    }

    if (!product.isActive) {
      const error = new Error("Producto no disponible");
      error.code = "PRODUCT_NOT_FOUND";
      throw error;
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
      const error = new Error("Stock insuficiente");
      error.code = "INSUFFICIENT_STOCK";
      error.details = {
        producto: product.name,
        stockDisponible: product.stock,
        cantidadEnCarrito: currentQuantity,
        cantidadSolicitada: currentQuantity + 1,
      };
      throw error;
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

    if (!cart) {
      return null;
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
      return null;
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
      return { count: 0 };
    }

    const deleted = await prisma.cartItem.deleteMany({
      where: {
        cartId: cart.id,
      },
    });

    return deleted;
  },
};
