import { OrderModel } from "../services/orders.js";

export class OrderController {
  // CREAR ORDEN
  static async create(req, res, next) {
    try {
      const { id, username } = req.user;

      const order = await OrderModel.create({ userId: id });

      return res.status(201).json({
        message: "Orden creada exitosamente",
        order: {
          id: order.id,
          user: username,
          status: order.status,
          total: order.total,
          createdAt: order.createdAt,
          productos: order.orderItems.map((item) => ({
            nombre: item.product.name,
            cantidad: item.quantity,
            precio: item.price,
            subtotal: item.price * item.quantity,
          })),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // VER Ã“RDENES
  static async getAll(req, res, next) {
    try {
      const { id } = req.user;

      const orders = await OrderModel.getAll({ id });

      const formattedOrders = orders.map((order) => ({
        id: order.id,
        status: order.status,
        total: order.total,
        createdAt: order.createdAt,
        productos: order.orderItems.map((item) => ({
          nombre: item.product.name,
          cantidad: item.quantity,
          precio: item.price,
        })),
      }));

      return res.json({ orders: formattedOrders });
    } catch (error) {
      next(error);
    }
  }

  // TODAS LAS ORDENES DE USUARIOS
  static async getUserOrders(req, res, next) {
    try {
      const orders = await OrderModel.getUserOrders();

      const formattedOrders = orders.map((order) => ({
        id: order.id,
        usuario: {
          id: order.user.id,
          username: order.user.username,
        },
        status: order.status,
        total: order.total,
        createdAt: order.createdAt,
        productos: order.orderItems.map((item) => ({
          nombre: item.product.name,
          cantidad: item.quantity,
          precio: item.price,
        })),
      }));

      return res.json({ orders: formattedOrders });
    } catch (error) {
      next(error);
    }
  }

  // VER ORDEN POR ID
  static async getById(req, res, next) {
    try {
      const { id: userId } = req.user;
      const { id: orderId } = req.params;

      const order = await OrderModel.getUserOrderById({
        userId,
        orderId,
      });

      return res.json({
        order: {
          id: order.id,
          status: order.status,
          total: order.total,
          createdAt: order.createdAt,
          updatedAt: order.updatedAt,
          productos: order.orderItems.map((item) => ({
            nombre: item.product.name,
            description: item.product.description,
            cantidad: item.quantity,
            precioUnitario: item.price,
            subtotal: item.price * item.quantity,
          })),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // ACTUALIZAR STATUS DE ORDEN
  static async update(req, res, next) {
    try {
      const { id: orderId } = req.params;
      const { status } = req.body;

      const order = await OrderModel.updateOrderStatus({
        orderId,
        status,
      });
      // Mensajes dinÃ¡micos correctos
      const statusMessages = {
        COMPLETED: "completada",
        CANCELLED: "cancelada",
        PENDING: "actualizada",
      };

      return res.json({
        message: `Orden ${statusMessages[status]} exitosamente`,

        order: {
          id: order.id,
          status: order.status,
          total: order.total,
          updatedAt: order.updatedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}
