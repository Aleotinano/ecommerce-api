import prisma from "../lib/prisma.js";

export const CartModel = {
  async getCart({ id }) {
    const cart = await prisma.cart.findUnique({
      where: { userId: parseInt(id) },
      include: { items: { include: { product: true } } },
    });

    return cart;
  },

  async add({ id, productId }) {
    const userIdInt = parseInt(id);
    const productIdInt = parseInt(productId);

    const cart = await prisma.cart.upsert({
      where: { userId: userIdInt },
      update: {},
      create: { userId: userIdInt },
    });

    const productAdded = await prisma.cartItem.upsert({
      where: {
        cartId_productId: {
          cartId: cart.id,
          productId: productIdInt,
        },
      },
      update: {
        quantity: { increment: 1 },
      },
      create: {
        cartId: cart.id,
        productId: productIdInt,
        quantity: 1,
      },
      include: {
        product: true,
      },
    });

    return productAdded;
  },

  async remove({ id, productId }) {
    const userIdInt = parseInt(id);
    const productIdInt = parseInt(productId);

    const cart = await prisma.cart.findUnique({
      where: { userId: userIdInt },
    });

    const cartItem = await prisma.cartItem.findUnique({
      where: {
        cartId_productId: {
          cartId: cart.id,
          productId: productIdInt,
        },
      },
    });

    if (cartItem.quantity === 1) {
      await prisma.cartItem.delete({
        where: {
          cartId_productId: {
            cartId: cart.id,
            productId: productIdInt,
          },
        },
      });

      return { deleted: true };
    }

    const updated = await prisma.cartItem.update({
      where: {
        cartId_productId: {
          cartId: cart.id,
          productId: productIdInt,
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
    const userIdInt = parseInt(id);

    const cart = await prisma.cart.findUnique({
      where: { userId: userIdInt },
    });

    const deleted = await prisma.cartItem.deleteMany({
      where: {
        cartId: cart.id,
      },
    });

    return deleted;
  },
};
