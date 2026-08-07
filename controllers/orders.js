import { OrderModel } from "../services/orders.js";
import { OrderReceiptModel } from "../services/order-receipts.js";
import { evaluateOrder } from "../services/order-state.js";
import { getStatusMeta } from "../services/order-status.js";
import { buildOrderWhatsappLink } from "../lib/whatsapp-link.js";
import {
  cleanupUploadedReceipt,
  getUploadedReceiptFile,
} from "../middleware/upload.js";
import { logger } from "../lib/logger.js";

const log = logger.child({ module: "orders-controller" });

// Estado de la orden según el motor (services/order-state.js): qué le falta para
// producirse y cómo viene el dinero. Va en las respuestas del backoffice para que
// el panel pueda deshabilitar el botón CON EL MOTIVO en vez de dejar que la
// persona apriete y se coma un 409.
function stateOf(order) {
  const { payment, blockers, canProduce } = evaluateOrder(order);
  return { payment, blockers, canProduce };
}

// Cómo se entrega y cómo se paga: el mismo bloque va en casi todas las
// respuestas de orden, así que se arma en un solo lugar.
function fulfillmentOf(order) {
  return {
    fulfillmentMethod: order.fulfillmentMethod,
    addressText: order.addressText,
    addressLat: order.addressLat,
    addressLng: order.addressLng,
    addressDetails: order.addressDetails,
    addressMapsUrl: order.addressMapsUrl,
    paymentMethod: order.paymentMethod,
    paymentNote: order.paymentNote,
    cashAmount: order.cashAmount,
    transferAmount: order.transferAmount,
    // Contacto de quien recibe. Va acá —y no solo en el listado— para que la
    // respuesta del review traiga el teléfono recién cargado y el panel lo
    // muestre sin recargar.
    contactPhone: order.contactPhone,
    contactName: order.contactName,
  };
}

// Deep-link de WhatsApp con el pedido redactado (lib/whatsapp-link.js).
// Best-effort, igual que el email de cambio de estado: la orden ya está creada
// y confirmada en DB, así que un problema armando el link no puede tumbar la
// respuesta. Devuelve null si el tenant no tiene un teléfono usable.
function buildWhatsappBlock(order) {
  try {
    return buildOrderWhatsappLink({ order, config: order.tenant?.config ?? {} });
  } catch (error) {
    log.error(
      { err: error, orderId: order.id },
      "no se pudo armar el link de WhatsApp del pedido"
    );
    return null;
  }
}

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
      // `req.user` es null en el checkout de invitado (la ruta del storefront usa
      // optionalStoreAuth): el dueño del carrito lo resuelve `resolveCartOwner`,
      // que deja el guestId de la cookie en `req.cartOwner`. Las rutas de admin no
      // pasan por ese middleware, así que ahí se arma desde el usuario del token.
      const { id = null, username = null } = req.user ?? {};
      const cartOwner = req.cartOwner ?? { userId: id, guestId: null };
      const {
        fulfillmentMethod,
        addressText,
        addressLat,
        addressLng,
        addressDetails,
        addressMapsUrl,
        paymentMethod,
        paymentNote,
        cashAmount,
        transferAmount,
        contactPhone,
        contactName,
      } = req.body;

      const order = await OrderModel.create({
        tenantId: req.tenantId,
        cartOwner,
        // Lo setea la ruta del storefront (routes/store/orders.js); una orden
        // cargada por un admin desde el panel queda como ADMIN.
        origin: req.orderOrigin ?? "ADMIN",
        fulfillmentMethod,
        addressText,
        addressLat,
        addressLng,
        addressDetails,
        addressMapsUrl,
        paymentMethod,
        paymentNote,
        cashAmount,
        transferAmount,
        contactPhone,
        contactName,
      });

      return res.status(201).json({
        message: "Orden creada exitosamente",
        order: {
          id: order.id,
          // Sin cuenta no hay username: el pedido se identifica con el nombre que
          // dio la persona, que es justamente lo que el invitado tiene que cargar.
          user: username ?? order.contactName ?? null,
          origin: order.origin,
          status: order.status,
          paymentStatus: order.paymentStatus,
          ...fulfillmentOf(order),
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
        // Deep-link para que el cliente mande el pedido por WhatsApp. Es la
        // continuación natural del checkout, pero NO es parte del pedido: si
        // el tenant no tiene número cargado o el armado falla, la orden ya
        // está creada y se devuelve igual con whatsapp: null.
        whatsapp: buildWhatsappBlock(order),
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
        // Sin esto el panel no puede distinguir una seña confirmada de una
        // pendiente: la respuesta de confirm-deposit sí lo trae, así que la
        // orden se mostraba bien hasta el siguiente fetch y ahí "se
        // desconfirmaba" sola.
        depositConfirmedAt: order.depositConfirmedAt,
        status: order.status,
        paymentStatus: order.paymentStatus,
        ...fulfillmentOf(order),
        ...stateOf(order),
        transferConfirmedAt: order.transferConfirmedAt,
        paymentConfirmedAt: order.paymentConfirmedAt,
        // Cuántos comprobantes tiene, no cuáles: alcanza para badgear la fila
        // ("hay algo para revisar") sin emitir una URL firmada por archivo en cada
        // listado. Las filas salen por GET /:id/receipts.
        receiptsCount: order._count?.receipts ?? 0,
        total: order.total,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        productos: order.orderItems.map((item) => ({
          id: item.id,
          productId: item.productId,
          variantId: item.variantId,
          nombre: item.product?.name ?? item.variant?.sku,
          cantidad: item.quantity,
          precio: item.price,
          // Mismo detalle de línea que el endpoint de detalle: el panel del admin
          // trabaja sobre esta lista, y sin imagen ni subtotal no puede mostrar
          // la ficha del producto al revisar el pedido.
          subtotal: item.price * item.quantity,
          image: item.variant?.img ?? item.product?.img ?? null,
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

      const isStaff = role === "ADMIN" || role === "STAFF";

      // ADMIN/STAFF pueden ver cualquier orden del tenant (incluidas las BOT,
      // que nacen con userId null); el resto solo su propia orden.
      const order = isStaff
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
          ...fulfillmentOf(order),
          transferConfirmedAt: order.transferConfirmedAt,
          // La seña completa: sin los tres campos, un consumidor del detalle no
          // tiene forma de saber que la orden la lleva ni si está confirmada.
          requiresDeposit: order.requiresDeposit,
          depositAmount: order.depositAmount,
          depositConfirmedAt: order.depositConfirmedAt,
          paymentConfirmedAt: order.paymentConfirmedAt,
          // Solo para el backoffice: al cliente no le sirve —ni le corresponde—
          // saber que su pedido está esperando que alguien lo revise.
          ...(isStaff ? stateOf(order) : {}),
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
            // Campo agregado, no cambiado: distingue el avance que hizo el motor
            // al cumplirse las condiciones del que apretó una persona.
            automatico: entry.trigger === "AUTO",
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
        READY: "marcada como lista",
        COMPLETED: "completada",
        CANCELLED: "cancelada",
        PENDING: "actualizada",
      };

      return res.json({
        // Del catálogo, no de una tabla local: el texto de un estado se escribe
        // una sola vez (services/order-status.js).
        message: `Orden ${getStatusMeta(status).admin.message} exitosamente`,
        order: {
          id: order.id,
          status: order.status,
          paymentStatus: order.paymentStatus,
          total: order.total,
          ...stateOf(order),
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
      const {
        items,
        fulfillmentMethod,
        addressText,
        addressLat,
        addressLng,
        addressDetails,
        addressMapsUrl,
        paymentMethod,
        paymentNote,
        cashAmount,
        transferAmount,
        contactPhone,
        contactName,
      } = req.body ?? {};

      const order = await OrderModel.reviewOrder({
        tenantId: req.tenantId,
        orderId,
        reviewedById: req.user.id,
        items: items ?? null,
        fulfillment: {
          fulfillmentMethod,
          addressText,
          addressLat,
          addressLng,
          addressDetails,
          addressMapsUrl,
          paymentMethod,
          paymentNote,
          cashAmount,
          transferAmount,
          contactPhone,
          contactName,
        },
      });

      return res.json({
        message: "Orden revisada exitosamente",
        order: {
          id: order.id,
          // Ojo: la revisión puede haber destrabado la orden y dejarla ya en
          // PROCESSING (avance automático, ver services/order-state.js). El
          // panel tiene que pintar lo que viene acá, no asumir que sigue en
          // PENDING.
          status: order.status,
          paymentStatus: order.paymentStatus,
          ...fulfillmentOf(order),
          ...stateOf(order),
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
        channel: req.body.channel,
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
          ...stateOf(order),
          updatedAt: order.updatedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Confirma la transferencia y, opcionalmente, adjunta el comprobante en el mismo
   * request (multipart con el campo `receipt`). Sigue aceptando JSON puro: quien
   * ya venía llamando a este endpoint no se entera del cambio.
   *
   * El archivo se sube ANTES de la transacción del cobro —red adentro de una
   * transacción es veneno—, así que si `confirmTransfer` falla después
   * (`TRANSFER_ALREADY_CONFIRMED`, por ejemplo) hay que borrar el comprobante
   * recién creado: mismo patrón que el rollback de imagen en controllers/productos.js.
   */
  static async confirmTransfer(req, res, next) {
    const uploadedFile = getUploadedReceiptFile(req);
    let receipt = null;

    try {
      const { id: orderId } = req.params;
      const receiptIds = [...(req.body.receiptIds ?? [])];

      if (uploadedFile) {
        receipt = await OrderReceiptModel.addReceipt({
          tenantId: req.tenantId,
          orderId,
          file: uploadedFile,
          uploadedById: req.user.id,
          note: req.body.note ?? null,
        });
        receiptIds.push(receipt.id);
      }

      const order = await OrderModel.confirmTransfer({
        tenantId: req.tenantId,
        orderId,
        confirmedById: req.user.id,
        amount: req.body.amount,
        receiptIds,
      });

      return res.json({
        message: "Transferencia confirmada exitosamente",
        order: {
          id: order.id,
          status: order.status,
          paymentMethod: order.paymentMethod,
          // Desde el libro de cobros, confirmar una transferencia SÍ mueve el
          // estado de pago (antes solo sellaba la fecha), así que la respuesta
          // tiene que traerlo o el panel se queda con el valor viejo.
          paymentStatus: order.paymentStatus,
          total: order.total,
          transferConfirmedAt: order.transferConfirmedAt,
          ...stateOf(order),
          updatedAt: order.updatedAt,
        },
        receiptId: receipt?.id ?? null,
      });
    } catch (error) {
      // La confirmación falló pero el comprobante ya está arriba: se borra, si no
      // queda un archivo con el CBU de alguien colgado de una orden que nunca se
      // confirmó y sin nada en la respuesta que lo mencione.
      if (receipt) {
        await OrderReceiptModel.removeReceipt({
          tenantId: req.tenantId,
          orderId: req.params.id,
          receiptId: receipt.id,
          deletedById: req.user.id,
        }).catch(() => {});
      }
      next(error);
    } finally {
      await cleanupUploadedReceipt(req).catch(() => {});
    }
  }

  /** Adjunta un comprobante SIN confirmar nada (ver services/order-receipts.js). */
  static async addReceipt(req, res, next) {
    try {
      const receipt = await OrderReceiptModel.addReceipt({
        tenantId: req.tenantId,
        orderId: req.params.id,
        file: getUploadedReceiptFile(req),
        uploadedById: req.user.id,
        note: req.body.note ?? null,
      });

      const receipts = await OrderReceiptModel.listReceipts({
        tenantId: req.tenantId,
        orderId: req.params.id,
      });

      return res.status(201).json({
        message: "Comprobante adjuntado exitosamente",
        receipt: receipts.find((r) => r.id === receipt.id) ?? null,
      });
    } catch (error) {
      next(error);
    } finally {
      await cleanupUploadedReceipt(req).catch(() => {});
    }
  }

  static async getReceipts(req, res, next) {
    try {
      const receipts = await OrderReceiptModel.listReceipts({
        tenantId: req.tenantId,
        orderId: req.params.id,
      });

      return res.json({ receipts });
    } catch (error) {
      next(error);
    }
  }

  static async removeReceipt(req, res, next) {
    try {
      await OrderReceiptModel.removeReceipt({
        tenantId: req.tenantId,
        orderId: req.params.id,
        receiptId: req.params.receiptId,
        deletedById: req.user.id,
      });

      return res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  static async confirmPayment(req, res, next) {
    try {
      const { id: orderId } = req.params;

      const order = await OrderModel.confirmPayment({
        tenantId: req.tenantId,
        orderId,
        confirmedById: req.user.id,
        channel: req.body.channel,
      });

      return res.json({
        message: "Pago confirmado exitosamente",
        order: {
          id: order.id,
          status: order.status,
          paymentStatus: order.paymentStatus,
          total: order.total,
          paymentConfirmedAt: order.paymentConfirmedAt,
          ...stateOf(order),
          updatedAt: order.updatedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // Alta directa en el libro de cobros. Es la vía general —los tres confirm-*
  // son atajos— y la única forma de registrar un pago parcial a cuenta o una
  // devolución.
  static async registerPayment(req, res, next) {
    try {
      const { id: orderId } = req.params;
      const { kind, channel, amount, note } = req.body;

      const order = await OrderModel.registerPayment({
        tenantId: req.tenantId,
        orderId,
        kind,
        channel,
        amount,
        note,
        actorId: req.user.id,
      });

      return res.status(201).json({
        message:
          kind === "REFUND"
            ? "Devolución registrada exitosamente"
            : "Cobro registrado exitosamente",
        order: {
          id: order.id,
          status: order.status,
          paymentStatus: order.paymentStatus,
          total: order.total,
          ...stateOf(order),
          updatedAt: order.updatedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async getPayments(req, res, next) {
    try {
      const { id: orderId } = req.params;

      const { payments, summary, pending } = await OrderModel.getPayments({
        tenantId: req.tenantId,
        orderId,
      });

      return res.json({
        payments: payments.map((entry) => ({
          id: entry.id,
          kind: entry.kind,
          channel: entry.channel,
          monto: entry.amount,
          note: entry.note,
          confirmedById: entry.confirmedById,
          confirmedAt: entry.confirmedAt,
        })),
        payment: summary,
        // Cuánto falta por cada vía. Es lo que el panel necesita para proponer un
        // monto al cobrar, sin que nadie lo calcule a mano.
        pending,
      });
    } catch (error) {
      next(error);
    }
  }
}
