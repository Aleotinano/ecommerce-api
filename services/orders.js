import prisma from "../lib/prisma.js";
import { createError } from "../helpers/error.js";

export const OrderModel = {
  async create({ userId }) {
    // Buscar el carrito del usuario e incluir productos
    const cart = await prisma.cart.findUnique({
      where: { userId },
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
    });

    // Validar que el carrito exista y tenga productos
    if (!cart || !cart.items || cart.items.length === 0) {
      const error = createError("El carrito está vacío", "EMPTY_CART", 400);
      throw error;
    }

    // Verificar stock de cada producto
    for (const item of cart.items) {
      if (!item.product.isActive) {
        const error = createError("Producto no disponible", "PRODUCT_NOT_AVAILABLE", 400);
        error.details = {
          producto: item.product.name,
        };
        throw error;
      }

      if (item.quantity > item.product.stock) {
        const error = createError("Stock insuficiente", "INSUFFICIENT_STOCK", 409);
        error.details = {
          producto: item.product.name,
          solicitado: item.quantity,
          disponible: item.product.stock,
        };
        throw error;
      }
    }

    // Calcular el total de la orden
    const total = cart.items.reduce((sum, item) => {
      return sum + item.product.price * item.quantity;
    }, 0);

    // Crear la orden con sus items en una transacción
    const order = await prisma.$transaction(async (tx) => {
      // Crear la orden
      const newOrder = await tx.order.create({
        data: {
          userId,
          total,
          status: "PENDING",
          orderItems: {
            create: cart.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              price: item.product.price,
            })),
          },
        },
        include: {
          orderItems: {
            include: {
              product: true,
            },
          },
        },
      });

      // Vaciar el carrito
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
      include: {
        orderItems: {
          include: {
            product: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!orders || orders.length === 0) {
      throw createError("No tienes Ã³rdenes todavÃ­a", "ORDERS_NOT_FOUND", 404);
    }

    return orders;
  },

  async getUserOrderById({ userId, orderId }) {
    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        userId,
      },
      include: {
        orderItems: {
          include: {
            product: true,
          },
        },
      },
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
        orderItems: {
          include: {
            product: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!orders || orders.length === 0) {
      throw createError("No hay Ã³rdenes registradas", "ORDERS_NOT_FOUND", 404);
    }

    return orders;
  },

  async updateOrderStatus({ orderId, status }) {
    // Buscar la orden
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        orderItems: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!order) {
      const error = createError("Orden no encontrada", "ORDER_NOT_FOUND", 404);
      throw error;
    }

    // Validar transiciones de estado
    if (order.status === "COMPLETED") {
      const error = createError("No se puede modificar una orden completada", "ORDER_ALREADY_COMPLETED", 409);
      throw error;
    }

    if (order.status === "CANCELLED") {
      const error = createError("No se puede modificar una orden cancelada", "ORDER_ALREADY_CANCELLED", 409);
      throw error;
    }

    // Si el nuevo status es el mismo, no hacer nada
    if (order.status === status) {
      return order;
    }

    if (status === "COMPLETED") {
      // Verificar que haya stock suficiente
      for (const item of order.orderItems) {
        if (item.quantity > item.product.stock) {
          const error = createError("Stock insuficiente para completar la orden", "INSUFFICIENT_STOCK", 409);
          error.details = {
            producto: item.product.name,
            solicitado: item.quantity,
            disponible: item.product.stock,
          };
          throw error;
        }
      }

      // Actualizar orden y reducir stock en una transacción
      const updatedOrder = await prisma.$transaction(async (tx) => {
        // Actualizar el status de la orden
        const updated = await tx.order.update({
          where: { id: orderId },
          data: { status },
          include: {
            orderItems: {
              include: {
                product: true,
              },
            },
          },
        });

        // Reducir el stock de cada producto
        for (const item of order.orderItems) {
          await tx.product.update({
            where: { id: item.productId },
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
        data: { status },
        include: {
          orderItems: {
            include: {
              product: true,
            },
          },
        },
      });

      return updatedOrder;
    }

    // por seguridad
    const error = createError("Transición de estado no permitida", "INVALID_STATUS_TRANSITION", 400);
    throw error;
  },
};

