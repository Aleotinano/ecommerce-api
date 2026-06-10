import prisma from "../lib/prisma.js";
import { createError } from "../helpers/error.js";
import { getProductPrice } from "../helpers/price.js";
import { sendMail, buildOrderStatusEmail } from "../lib/mailer.js";
import { logger } from "../lib/logger.js";

const log = logger.child({ module: "orders" });

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
  async create({ tenantId, userId }) {
    const cart = await prisma.cart.findFirst({
      where: { userId, tenantId },
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
        where: { id: { in: variantIds }, tenantId },
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
        const price = getProductPrice(variant, variant.product);
        if (price == null) {
          const error = createError(
            "Producto o variante sin precio",
            "PRODUCT_NO_PRICE",
            400
          );
          error.details = { variant: variant.id };
          throw error;
        }
        return sum + Number(price) * item.quantity;
      }, 0);

      const newOrder = await tx.order.create({
        data: {
          tenantId,
          userId,
          total,
          status: "PENDING",
          orderItems: {
            create: cart.items.map((item) => {
              const variant = variantMap.get(item.variantId);
              return {
                variantId: item.variantId,
                quantity: item.quantity,
                price: getProductPrice(variant, variant.product),
              };
            }),
          },
        },
        ...orderItemsInclude,
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: newOrder.id,
          fromStatus: null,
          toStatus: "PENDING",
          note: "Pedido creado",
          changedById: userId,
        },
      });

      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

      return newOrder;
    });
  },

  async getAll({ tenantId, userId, status, limit = 10, offset = 0 }) {
    const where = { userId, tenantId };

    if (status) {
      where.status = status;
    }

    return prisma.order.findMany({
      where,
      ...orderItemsInclude,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });
  },

  async getUserOrderById({ tenantId, userId, orderId }) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, userId, tenantId },
      include: {
        ...orderItemsInclude.include,
        statusHistory: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!order) {
      throw createError("Orden no encontrada", "ORDER_NOT_FOUND", 404);
    }

    return order;
  },

  async getUserOrders({ tenantId, status, search, limit = 10, offset = 0 }) {
    const where = { tenantId };

    if (status) {
      where.status = status;
    }

    if (search) {
      where.OR = [
        { user: { username: { contains: search, mode: "insensitive" } } },
        {
          orderItems: {
            some: {
              variant: {
                product: { name: { contains: search, mode: "insensitive" } },
              },
            },
          },
        },
      ];
    }

    return prisma.order.findMany({
      where,
      include: {
        user: {
          select: { id: true, username: true },
        },
        ...orderItemsInclude.include,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });
  },

  async updateOrderStatus({
    tenantId,
    orderId,
    status,
    extraData = {},
    changedById = null,
    note = null,
  }) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: {
        ...orderItemsInclude.include,
        user: { select: { id: true, username: true, email: true } },
        tenant: { select: { name: true } },
      },
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

    if (!["PROCESSING", "COMPLETED", "CANCELLED"].includes(status)) {
      throw createError(
        "Transición de estado no permitida",
        "INVALID_STATUS_TRANSITION",
        400
      );
    }

    const recordHistory = (tx) =>
      tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: order.status,
          toStatus: status,
          note,
          changedById,
        },
      });

    const updated = await prisma.$transaction(async (tx) => {
      if (status === "COMPLETED") {
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
      }

      const result = await tx.order.update({
        where: { id: orderId },
        data: { status, ...extraData },
        ...orderItemsInclude,
      });

      if (status === "COMPLETED") {
        for (const item of order.orderItems) {
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { stock: { decrement: item.quantity } },
          });
        }
      }

      await recordHistory(tx);

      return result;
    });

    // Notificación al cliente (best-effort, no debe romper la actualización).
    if (order.user?.email) {
      try {
        const { subject, text, html } = buildOrderStatusEmail({
          orderId,
          status,
          tenantName: order.tenant?.name,
        });
        await sendMail({ to: order.user.email, subject, text, html });
      } catch (error) {
        log.error(
          { err: error, orderId, status },
          "no se pudo enviar el email de cambio de estado"
        );
      }
    }

    return updated;
  },
};
