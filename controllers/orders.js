import { OrderModel } from "../services/orders.js";

export class OrderController {
  static async create(req, res, next) {
    try {
      const { id, username } = req.user;

      const order = await OrderModel.create({
        tenantId: req.tenantId,
        userId: id,
      });

      return res.status(201).json({
        message: "Orden creada exitosamente",
        order: {
          id: order.id,
          user: username,
          status: order.status,
          paymentStatus: order.paymentStatus,
          total: order.total,
          createdAt: order.createdAt,
          productos: order.orderItems.map((item) => ({
            nombre: item.variant.product?.name ?? item.variant.sku,
            cantidad: item.quantity,
            precio: item.price,
            subtotal: item.price * item.quantity,
            color: item.variant.color,
            size: item.variant.size,
          })),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async getAll(req, res, next) {
    try {
      const { id } = req.user;
      const { status, limit, offset } = req.search ?? {};

      const orders = await OrderModel.getAll({
        tenantId: req.tenantId,
        userId: id,
        status,
        limit,
        offset,
      });

      const formattedOrders = orders.map((order) => ({
        id: order.id,
        status: order.status,
        paymentStatus: order.paymentStatus,
        total: order.total,
        createdAt: order.createdAt,
        productos: order.orderItems.map((item) => ({
          nombre: item.variant.product?.name ?? item.variant.sku,
          cantidad: item.quantity,
          precio: item.price,
          color: item.variant.color,
          size: item.variant.size,
        })),
      }));

      return res.json({ orders: formattedOrders });
    } catch (error) {
      next(error);
    }
  }

  static async getUserOrders(req, res, next) {
    try {
      const { status, search, limit, offset } = req.search;

      const orders = await OrderModel.getUserOrders({
        tenantId: req.tenantId,
        status,
        search,
        limit,
        offset,
      });

      const formattedOrders = orders.map((order) => ({
        id: order.id,
        usuario: {
          id: order.user.id,
          username: order.user.username,
        },
        status: order.status,
        paymentStatus: order.paymentStatus,
        total: order.total,
        createdAt: order.createdAt,
        productos: order.orderItems.map((item) => ({
          nombre: item.variant.product?.name ?? item.variant.sku,
          cantidad: item.quantity,
          precio: item.price,
          color: item.variant.color,
          size: item.variant.size,
        })),
      }));

      return res.json({ orders: formattedOrders });
    } catch (error) {
      next(error);
    }
  }

  static async getById(req, res, next) {
    try {
      const { id: userId } = req.user;
      const { id: orderId } = req.params;

      const order = await OrderModel.getUserOrderById({
        tenantId: req.tenantId,
        userId,
        orderId,
      });

      return res.json({
        order: {
          id: order.id,
          status: order.status,
          paymentStatus: order.paymentStatus,
          total: order.total,
          createdAt: order.createdAt,
          updatedAt: order.updatedAt,
          productos: order.orderItems.map((item) => ({
            nombre: item.variant.product?.name ?? item.variant.sku,
            description: item.variant.product?.description,
            cantidad: item.quantity,
            precioUnitario: item.price,
            subtotal: item.price * item.quantity,
            color: item.variant.color,
            size: item.variant.size,
            image: item.variant.img ?? item.variant.product?.img ?? null,
          })),
          timeline: (order.statusHistory ?? []).map((entry) => ({
            estado: entry.toStatus,
            nota: entry.note,
            fecha: entry.createdAt,
          })),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async update(req, res, next) {
    try {
      const { id: orderId } = req.params;
      const { status, note } = req.body;

      const order = await OrderModel.updateOrderStatus({
        tenantId: req.tenantId,
        orderId,
        status,
        changedById: req.user.id,
        note,
      });

      const statusMessages = {
        PROCESSING: "en preparación",
        COMPLETED: "completada",
        CANCELLED: "cancelada",
        PENDING: "actualizada",
      };

      return res.json({
        message: `Orden ${statusMessages[status]} exitosamente`,
        order: {
          id: order.id,
          status: order.status,
          paymentStatus: order.paymentStatus,
          total: order.total,
          updatedAt: order.updatedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}
