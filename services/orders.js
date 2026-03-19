import prisma from "../lib/prisma.js";
import { createError } from "../helpers/error.js";

const orderItemsInclude = {
  orderItems: {
    include: {
      variant: {
        include: {
          product: true,
        },
      },
    },
  },
};

const ensureHasVariants = (items) => {
  for (const item of items) {
    if (!item.variant) {
      throw createError("Variante no encontrada", "VARIANT_NOT_FOUND", 404);
    }
  }
};

export const OrderModel = {
  async create({ userId }) {
    const cart = await prisma.cart.findUnique({
      where: { userId },
      include: {
        items: {
          include: {
            variant: {
              include: {
                product: true,
              },
            },
          },
        },
      },
    });

    if (!cart || !cart.items || cart.items.length === 0) {
      throw createError("El carrito est� vac�o", "EMPTY_CART", 400);
    }

    ensureHasVariants(cart.items);

    for (const item of cart.items) {
      if (!item.variant.isActive) {
        const error = createError(
          "Variante no disponible",
          "VARIANT_NOT_AVAILABLE",
          400
        );
        error.details = {
          variant: item.variant.id,
        };
        throw error;
      }

      if (!item.variant.product?.isActive) {
        const error = createError(
          "Producto no disponible",
          "PRODUCT_NOT_AVAILABLE",
          400
        );
        error.details = {
          product: item.variant.product?.name ?? null,
        };
        throw error;
      }

      if (item.quantity > item.variant.stock) {
        const error = createError(
          "Stock insuficiente",
          "INSUFFICIENT_STOCK",
          409
        );
        error.details = {
          variant: item.variant.id,
          solicitado: item.quantity,
          disponible: item.variant.stock,
        };
        throw error;
      }
    }

    const total = cart.items.reduce((sum, item) => {
      return sum + Number(item.variant.price) * item.quantity;
    }, 0);

    const order = await prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          userId,
          total,
          status: "PENDING",
          orderItems: {
            create: cart.items.map((item) => ({
              variantId: item.variantId,
              quantity: item.quantity,
              price: item.variant.price,
            })),
          },
        },
        include: orderItemsInclude,
      });

      await tx.cartItem.deleteMany({
        where: {
          cartId: cart.id,
        },
      });

      return newOrder;
    });

    return order;
  },

  async getAll({ id }) {
    const orders = await prisma.order.findMany({
      where: { userId: id },
      ...orderItemsInclude,
      orderBy: {
        createdAt: "desc",
      },
    });

    return orders;
  },

  async getUserOrderById({ userId, orderId }) {
    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        userId,
      },
      ...orderItemsInclude,
    });

    if (!order) {
      throw createError("Orden no encontrada", "ORDER_NOT_FOUND", 404);
    }

    return order;
  },

  async getUserOrders() {
    const orders = await prisma.order.findMany({
      include: {
        user: {
          select: {
            id: true,
            username: true,
          },
        },
        ...orderItemsInclude,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!orders || orders.length === 0) {
      return [];
    }

    return orders;
  },

  async updateOrderStatus({ orderId, status, extraData = {} }) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      ...orderItemsInclude,
    });

    if (!order) {
      throw createError("Orden no encontrada", "ORDER_NOT_FOUND", 404);
    }

    if (order.status === "COMPLETED") {
      throw createError(
        "No se puede modificar una orden completada",
        "ORDER_ALREADY_COMPLETED",
        409
      );
    }

    if (order.status === "CANCELLED") {
      throw createError(
        "No se puede modificar una orden cancelada",
        "ORDER_ALREADY_CANCELLED",
        409
      );
    }

    if (order.status === status) {
      return order;
    }

    if (status === "COMPLETED") {
      for (const item of order.orderItems) {
        if (item.quantity > item.variant.stock) {
          const error = createError(
            "Stock insuficiente",
            "INSUFFICIENT_STOCK",
            409
          );
          error.details = {
            variant: item.variant.id,
            solicitado: item.quantity,
            disponible: item.variant.stock,
          };
          throw error;
        }
      }

      const updatedOrder = await prisma.$transaction(async (tx) => {
        const updated = await tx.order.update({
          where: { id: orderId },
          data: {
            status,
            ...extraData,
          },
          ...orderItemsInclude,
        });

        for (const item of order.orderItems) {
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: {
              stock: {
                decrement: item.quantity,
              },
            },
          });
        }

        return updated;
      });

      return updatedOrder;
    }

    if (status === "CANCELLED") {
      const updatedOrder = await prisma.order.update({
        where: { id: orderId },
        data: { status, ...extraData },
        ...orderItemsInclude,
      });

      return updatedOrder;
    }

    throw createError(
      "Transici�n de estado no permitida",
      "INVALID_STATUS_TRANSITION",
      400
    );
  },
};
