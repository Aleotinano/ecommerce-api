import { OrderModel } from "../services/orders.js";

// Composición de un combo (childItems, ver services/orders.js) para exponer en
// las respuestas de orden — null si la línea no es un combo.
function comboOf(item) {
  return item.childItems?.length
    ? item.childItems.map((child) => ({
        productId: child.productId,
        variantId: child.variantId,
        nombre: child.product?.name ?? child.variant?.sku,
        cantidad: child.quantity,
        attributes: child.variant?.attributes ?? {},
      }))
    : null;
}

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
            id: item.id,
            productId: item.productId,
            variantId: item.variantId,
            nombre: item.product?.name ?? item.variant?.sku,
            cantidad: item.quantity,
            precio: item.price,
            subtotal: item.price * item.quantity,
            attributes: item.variant?.attributes ?? {},
            note: item.note,
            combo: comboOf(item),
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
          id: item.id,
          productId: item.productId,
          variantId: item.variantId,
          nombre: item.product?.name ?? item.variant?.sku,
          cantidad: item.quantity,
          precio: item.price,
          attributes: item.variant?.attributes ?? {},
          note: item.note,
          combo: comboOf(item),
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
        // Las órdenes del bot no tienen usuario registrado: usuario queda null y
        // el cliente se identifica por contactName/contactPhone.
        usuario: order.user
          ? { id: order.user.id, username: order.user.username }
          : null,
        origin: order.origin,
        contactName: order.contactName,
        contactPhone: order.contactPhone,
        reviewedAt: order.reviewedAt,
        requiresDeposit: order.requiresDeposit,
        depositAmount: order.depositAmount,
        status: order.status,
        paymentStatus: order.paymentStatus,
        total: order.total,
        createdAt: order.createdAt,
        productos: order.orderItems.map((item) => ({
          id: item.id,
          productId: item.productId,
          variantId: item.variantId,
          nombre: item.product?.name ?? item.variant?.sku,
          cantidad: item.quantity,
          precio: item.price,
          attributes: item.variant?.attributes ?? {},
          note: item.note,
          combo: comboOf(item),
        })),
      }));

      return res.json({ orders: formattedOrders });
    } catch (error) {
      next(error);
    }
  }

  static async getById(req, res, next) {
    try {
      const { id: userId, role } = req.user;
      const { id: orderId } = req.params;

      // ADMIN/STAFF pueden ver cualquier orden del tenant (incluidas las BOT,
      // que nacen con userId null); el resto solo su propia orden.
      const order =
        role === "ADMIN" || role === "STAFF"
          ? await OrderModel.getOrderById({ tenantId: req.tenantId, orderId })
          : await OrderModel.getUserOrderById({
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
            id: item.id,
            productId: item.productId,
            variantId: item.variantId,
            nombre: item.product?.name ?? item.variant?.sku,
            description: item.product?.description,
            cantidad: item.quantity,
            precioUnitario: item.price,
            subtotal: item.price * item.quantity,
            attributes: item.variant?.attributes ?? {},
            image: item.variant?.img ?? item.product?.img ?? null,
            note: item.note,
            combo: comboOf(item),
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

  static async review(req, res, next) {
    try {
      const { id: orderId } = req.params;
      const { items } = req.body ?? {};

      const order = await OrderModel.reviewOrder({
        tenantId: req.tenantId,
        orderId,
        reviewedById: req.user.id,
        items: items ?? null,
      });

      return res.json({
        message: "Orden revisada exitosamente",
        order: {
          id: order.id,
          status: order.status,
          paymentStatus: order.paymentStatus,
          total: order.total,
          requiresDeposit: order.requiresDeposit,
          depositAmount: order.depositAmount,
          reviewedAt: order.reviewedAt,
          updatedAt: order.updatedAt,
          productos: order.orderItems.map((item) => ({
            id: item.id,
            productId: item.productId,
            variantId: item.variantId,
            nombre: item.product?.name ?? item.variant?.sku,
            cantidad: item.quantity,
            precio: item.price,
            subtotal: item.price * item.quantity,
            attributes: item.variant?.attributes ?? {},
            note: item.note,
            combo: comboOf(item),
          })),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async confirmDeposit(req, res, next) {
    try {
      const { id: orderId } = req.params;

      const order = await OrderModel.confirmDeposit({
        tenantId: req.tenantId,
        orderId,
        confirmedById: req.user.id,
      });

      return res.json({
        message: "Seña confirmada exitosamente",
        order: {
          id: order.id,
          status: order.status,
          paymentStatus: order.paymentStatus,
          total: order.total,
          depositAmount: order.depositAmount,
          depositConfirmedAt: order.depositConfirmedAt,
          updatedAt: order.updatedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}
