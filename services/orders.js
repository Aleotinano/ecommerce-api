import prisma from "../lib/prisma.js";
import { createError } from "../helpers/error.js";

const orderItemsInclude = {
  include: {
    orderItems: {
      include: {
        variant: {
          include: {
            product: true,
          },
        },
      },
    },
  },
};

export const OrderModel = {
  async create({ userId }) {
    const cart = await prisma.cart.findUnique({
      where: { userId },
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

    if (!cart || cart.items.length === 0) {
      throw createError("El carrito está vacío", "EMPTY_CART", 400);
    }

    return prisma.$transaction(async (tx) => {
      const variantIds = cart.items.map((item) => item.variantId);
      const variants = await tx.productVariant.findMany({
        where: { id: { in: variantIds } },
        include: { product: true },
      });

      const variantMap = new Map(variants.map((v) => [v.id, v]));

      for (const item of cart.items) {
        const variant = variantMap.get(item.variantId);

        if (!variant) {
          throw createError("Variante no encontrada", "VARIANT_NOT_FOUND", 404);
        }

        if (!variant.isActive) {
          const error = createError(
            "Variante no disponible",
            "VARIANT_NOT_AVAILABLE",
            400
          );
          error.details = { variant: variant.id };
          throw error;
        }

        if (!variant.product?.isActive) {
          const error = createError(
            "Producto no disponible",
            "PRODUCT_NOT_AVAILABLE",
            400
          );
          error.details = { product: variant.product?.name ?? null };
          throw error;
        }

        if (item.quantity > variant.stock) {
          const error = createError(
            "Stock insuficiente",
            "INSUFFICIENT_STOCK",
            409
          );
          error.details = {
            variant: variant.id,
            solicitado: item.quantity,
            disponible: variant.stock,
          };
          throw error;
        }
      }

      const total = cart.items.reduce((sum, item) => {
        const variant = variantMap.get(item.variantId);
        return sum + Number(variant.price) * item.quantity;
      }, 0);

      const newOrder = await tx.order.create({
        data: {
          userId,
          total,
          status: "PENDING",
          orderItems: {
            create: cart.items.map((item) => ({
              variantId: item.variantId,
              quantity: item.quantity,
              price: variantMap.get(item.variantId).price,
            })),
          },
        },
        ...orderItemsInclude,
      });

      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

      return newOrder;
    });
  },

  async getAll({ userId }) {
    return prisma.order.findMany({
      where: { userId },
      ...orderItemsInclude,
      orderBy: { createdAt: "desc" },
    });
  },

  async getUserOrderById({ userId, orderId }) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, userId },
      ...orderItemsInclude,
    });

    if (!order) {
      throw createError("Orden no encontrada", "ORDER_NOT_FOUND", 404);
    }

    return order;
  },

  async getUserOrders() {
    return prisma.order.findMany({
      include: {
        user: {
          select: { id: true, username: true },
        },
        ...orderItemsInclude.include,
      },
      orderBy: { createdAt: "desc" },
    });
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

    if (status === "PROCESSING") {
      return prisma.order.update({
        where: { id: orderId },
        data: { status, ...extraData },
        ...orderItemsInclude,
      });
    }

    if (status === "COMPLETED") {
      return prisma.$transaction(async (tx) => {
        for (const item of order.orderItems) {
          if (item.quantity > item.variant.stock) {
            const error = createError(
              "Stock insuficiente al completar la orden",
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

        const updated = await tx.order.update({
          where: { id: orderId },
          data: { status, ...extraData },
          ...orderItemsInclude,
        });

        for (const item of order.orderItems) {
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { stock: { decrement: item.quantity } },
          });
        }

        return updated;
      });
    }

    if (status === "CANCELLED") {
      return prisma.order.update({
        where: { id: orderId },
        data: { status, ...extraData },
        ...orderItemsInclude,
      });
    }

    throw createError(
      "Transición de estado no permitida",
      "INVALID_STATUS_TRANSITION",
      400
    );
  },
};
