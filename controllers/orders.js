import { OrderModel } from "../services/orders.js";

export class OrderController {
  // CREAR ORDEN
  static async create(req, res) {
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
      switch (error.code) {
        case "EMPTY_CART":
          return res.status(400).json({
            message: "No hay productos en el carrito",
          });

        case "PRODUCT_NOT_AVAILABLE":
          return res.status(400).json({
            message: "Producto/s no disponible/s",
            data: error.details,
          });

        case "INSUFFICIENT_STOCK":
          return res.status(400).json({
            message: "Producto/s sin stock",
            data: error.details,
          });

        default:
          console.error("Error al crear orden:", error);
          return res.status(500).json({
            message: "Error al crear la orden",
          });
      }
    }
  }

  // VER ÓRDENES
  static async getAll(req, res) {
    try {
      const { id } = req.user;

      const orders = await OrderModel.getAll({ id });

      if (!orders || orders.length === 0) {
        return res.status(404).json({
          message: "No tienes órdenes todavía",
        });
      }

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
      console.error("Error al obtener órdenes:", error);
      return res.status(500).json({
        message: "Error al obtener las órdenes",
      });
    }
  }

  // TODAS LAS ORDENES DE USUARIOS
  static async getUserOrders(req, res) {
    try {
      const orders = await OrderModel.getUserOrders();

      if (!orders || orders.length === 0) {
        return res.status(404).json({
          message: "No hay órdenes registradas",
        });
      }

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
      console.error("Error al obtener todas las órdenes:", error);
      return res.status(500).json({
        message: "Error al obtener las órdenes",
      });
    }
  }

  // VER ORDEN POR ID
  static async getById(req, res) {
    try {
      const { id: userId } = req.user;
      const { id: orderId } = req.params;

      const order = await OrderModel.getUserOrderById({
        userId,
        orderId,
      });

      if (!order) {
        return res.status(404).json({
          message: "Orden no encontrada",
        });
      }

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
      console.error("Error al obtener orden:", error);
      return res.status(500).json({
        message: "Error al obtener la orden",
      });
    }
  }

  // ACTUALIZAR STATUS DE ORDEN
  static async update(req, res) {
    try {
      const { id: orderId } = req.params;
      const { status } = req.body;

      const order = await OrderModel.updateOrderStatus({
        orderId,
        status,
      });
      // Mensajes dinámicos correctos
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
      switch (error.code) {
        case "ORDER_NOT_FOUND":
          return res.status(404).json({
            message: "Orden no encontrada",
          });

        case "ORDER_ALREADY_COMPLETED":
          return res.status(400).json({
            message: "No se puede modificar una orden ya completada",
          });

        case "ORDER_ALREADY_CANCELLED":
          return res.status(400).json({
            message: "No se puede modificar una orden ya cancelada",
          });

        case "INSUFFICIENT_STOCK":
          return res.status(400).json({
            message: "No hay stock suficiente para completar esta orden",
            data: error.details,
          });

        case "INVALID_STATUS_TRANSITION":
          return res.status(400).json({
            message: "Transición de estado no permitida",
          });

        default:
          console.error("Error al actualizar orden:", error);
          return res.status(500).json({
            message: "Error al actualizar el estado de la orden",
          });
      }
    }
  }
}
