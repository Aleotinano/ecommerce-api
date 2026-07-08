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

/** Redondea un monto a 2 decimales (el modelo usa Float). */
const roundMoney = (n) => Math.round(n * 100) / 100;

/**
 * Valida una lista de items `{ variantId, quantity }` contra el catálogo del
 * tenant y resuelve el precio SERVER-SIDE. Devuelve los items con precio y el
 * total. Compartido por la creación desde carrito y la creación borrador del bot
 * (no se duplica la validación ni el pricing). Corre dentro de una transacción.
 *
 * @param {object}  tx                 cliente de transacción de Prisma
 * @param {number}  tenantId
 * @param {Array}   items              `[{ variantId, quantity, note? }]`
 * @param {object}  [opts]
 * @param {boolean} [opts.checkStock]  si valida stock (carrito sí; bot a-pedido no)
 * @returns {Promise<{ pricedItems: Array, total: number }>}
 */
async function priceItems(tx, tenantId, items, { checkStock = true } = {}) {
  const variantIds = items.map((i) => i.variantId);
  const variants = await tx.productVariant.findMany({
    where: { id: { in: variantIds }, tenantId },
    include: { product: true },
  });
  const variantMap = new Map(variants.map((v) => [v.id, v]));

  const pricedItems = items.map((item) => {
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

    if (checkStock && item.quantity > variant.stock) {
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

    return {
      variantId: item.variantId,
      quantity: item.quantity,
      price: Number(price),
      note: item.note ?? null,
    };
  });

  const total = pricedItems.reduce((sum, it) => sum + it.price * it.quantity, 0);
  return { pricedItems, total };
}

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
      const { pricedItems, total } = await priceItems(
        tx,
        tenantId,
        cart.items.map((item) => ({
          variantId: item.variantId,
          quantity: item.quantity,
          note: item.note,
        }))
      );

      const newOrder = await tx.order.create({
        data: {
          tenantId,
          userId,
          total,
          status: "PENDING",
          orderItems: {
            create: pricedItems.map(({ variantId, quantity, price, note }) => ({
              variantId,
              quantity,
              price,
              note,
            })),
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

  /**
   * Detalle de orden para ADMIN/STAFF: no filtra por userId, solo por tenant.
   * Necesario porque las órdenes BOT nacen con userId null (getUserOrderById
   * nunca las encontraría para un admin).
   */
  async getOrderById({ tenantId, orderId }) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
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

    // Guard de "bueno para producir": al pasar a producción/completar exigimos
    // que una orden del bot esté revisada por un humano y, si lleva seña, que la
    // seña esté confirmada. CANCELLED queda libre (siempre se puede cancelar).
    // Si el tenant no usa seña y la orden es ADMIN, nada de esto aplica.
    if (status === "PROCESSING" || status === "COMPLETED") {
      if (order.origin === "BOT" && order.reviewedById == null) {
        throw createError(
          "La orden creada por el bot debe ser revisada antes de producir",
          "ORDER_NOT_REVIEWED",
          409
        );
      }
      if (
        order.requiresDeposit &&
        !["DEPOSIT_PAID", "PAID_IN_FULL", "APPROVED"].includes(
          order.paymentStatus
        )
      ) {
        throw createError(
          "La seña debe estar confirmada antes de producir",
          "DEPOSIT_NOT_CONFIRMED",
          409
        );
      }
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

  /**
   * Acción admin: marca la orden como REVISADA (procedencia validada por un
   * humano). Permite corrección inline de cantidades antes de validar: si llegan
   * `items`, se re-resuelve precio y total SERVER-SIDE (nunca se confía en el
   * precio/total del cliente) y, como la seña todavía no está confirmada, se
   * recalcula `depositAmount`. NO mueve `status` ni `paymentStatus`.
   *
   * @param {object} p
   * @param {number} p.tenantId
   * @param {number} p.orderId
   * @param {number} p.reviewedById   admin que valida
   * @param {Array|null} [p.items]    `[{ id, quantity, note? }]` correcciones,
   *                                  `id` es el OrderItem.id (no variantId: una
   *                                  orden puede tener 2 filas de la misma
   *                                  variante con notas distintas)
   */
  async reviewOrder({ tenantId, orderId, reviewedById, items = null }) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: { ...orderItemsInclude.include },
    });

    if (!order) {
      throw createError("Orden no encontrada", "ORDER_NOT_FOUND", 404);
    }

    if (order.status !== "PENDING") {
      throw createError(
        "Solo se puede revisar una orden pendiente",
        "ORDER_NOT_PENDING",
        409
      );
    }

    const hasEdits = Array.isArray(items) && items.length > 0;

    return prisma.$transaction(async (tx) => {
      const data = { reviewedById, reviewedAt: new Date() };

      if (hasEdits) {
        const orderItemIds = new Set(order.orderItems.map((it) => it.id));
        for (const edit of items) {
          if (!orderItemIds.has(edit.id)) {
            const error = createError(
              "El item no pertenece a la orden",
              "ORDER_ITEM_NOT_FOUND",
              404
            );
            error.details = { orderItemId: edit.id };
            throw error;
          }
        }

        // Re-resolvemos TODOS los items (con las cantidades/notas nuevas donde
        // las haya) para recomputar precio y total server-side. Sin chequeo de
        // stock: la orden ya existe y Desvare es a-pedido.
        const desired = order.orderItems.map((it) => {
          const edit = items.find((e) => e.id === it.id);
          return {
            variantId: it.variantId,
            quantity: edit ? edit.quantity : it.quantity,
            // "note" in edit distingue "no la mandó" (mantener la actual) de
            // "la mandó en null" (borrarla).
            note: edit && "note" in edit ? edit.note : it.note,
          };
        });

        const { pricedItems, total } = await priceItems(tx, tenantId, desired, {
          checkStock: false,
        });

        // Ya no hay unique([orderId, variantId]) (una orden puede tener dos
        // líneas del mismo producto con notas distintas), así que se actualiza
        // por id de fila. `pricedItems` preserva el orden de `desired`, que a
        // su vez viene de mapear `order.orderItems` en el mismo orden.
        for (const [index, pi] of pricedItems.entries()) {
          await tx.orderItem.update({
            where: { id: order.orderItems[index].id },
            data: { quantity: pi.quantity, price: pi.price, note: pi.note },
          });
        }

        data.total = total;

        if (order.requiresDeposit) {
          const config = await tx.tenantConfig.findUnique({
            where: { tenantId },
            select: { depositPercentage: true },
          });
          const pct = config?.depositPercentage ?? 50;
          data.depositAmount = roundMoney((total * pct) / 100);
        }
      }

      return tx.order.update({
        where: { id: orderId },
        data,
        ...orderItemsInclude,
      });
    });
  },

  /**
   * Acción admin: confirma la seña (el dueño verificó la transferencia a ojo).
   * Mueve `paymentStatus` a DEPOSIT_PAID y sella quién/cuándo. NO mueve `status`.
   * Es independiente de `reviewOrder` (la seña suele confirmarse días después).
   * Solo opera si la orden requiere seña y el pago sigue en PENDING, así no pisa
   * un APPROVED/PAID_IN_FULL escrito por el webhook de MercadoPago.
   */
  async confirmDeposit({ tenantId, orderId, confirmedById }) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
    });

    if (!order) {
      throw createError("Orden no encontrada", "ORDER_NOT_FOUND", 404);
    }

    if (!order.requiresDeposit) {
      throw createError(
        "La orden no requiere seña",
        "DEPOSIT_NOT_REQUIRED",
        409
      );
    }

    if (order.paymentStatus !== "PENDING") {
      throw createError(
        "El estado de pago no permite confirmar la seña",
        "DEPOSIT_NOT_CONFIRMABLE",
        409
      );
    }

    return prisma.order.update({
      where: { id: orderId },
      data: {
        paymentStatus: "DEPOSIT_PAID",
        depositConfirmedById: confirmedById,
        depositConfirmedAt: new Date(),
      },
      ...orderItemsInclude,
    });
  },

  /**
   * Creación de orden BORRADOR por el bot de WhatsApp. Origen BOT, sin revisar.
   * El bot solo propone `items` ya resueltos a `{ variantId, quantity, note? }`;
   * acá el server valida catálogo/precio y resuelve TODO lo monetario y la
   * seña. El bot nunca toca `paymentStatus`, `depositAmount` ni `tenantId`.
   *
   * @param {object} p
   * @param {number} p.tenantId        resuelto del phone_number_id, nunca del LLM
   * @param {Array}  p.items           `[{ variantId, quantity, note? }]`
   * @param {string|null} [p.contactPhone]   wa_id del cliente
   * @param {string|null} [p.contactName]
   * @param {string|null} [p.creationContext] snapshot de la conversación
   */
  async createDraft({
    tenantId,
    items,
    contactPhone = null,
    contactName = null,
    creationContext = null,
  }) {
    if (!Array.isArray(items) || items.length === 0) {
      throw createError("La orden no tiene items", "EMPTY_ORDER", 400);
    }

    // Merge de items repetidos por variante + nota: el bot podría proponer la
    // misma variante en dos renglones. Solo se suma la cantidad si la nota
    // coincide (normalizada) — dos líneas con observaciones distintas (ej.
    // "sin nueces" vs "dedicatoria: Juan") deben quedar como filas separadas.
    const normalizeNote = (note) => (note ?? "").trim();
    const mergedMap = new Map();
    for (const it of items) {
      const note = normalizeNote(it.note);
      const key = `${it.variantId}::${note}`;
      const existing = mergedMap.get(key);
      mergedMap.set(key, {
        variantId: it.variantId,
        note: note || null,
        quantity: (existing?.quantity ?? 0) + it.quantity,
      });
    }
    const mergedItems = [...mergedMap.values()];

    const config = await prisma.tenantConfig.findUnique({
      where: { tenantId },
      select: { depositEnabled: true, depositPercentage: true },
    });
    const requiresDeposit = config?.depositEnabled ?? false;
    const depositPercentage = config?.depositPercentage ?? 50;

    return prisma.$transaction(async (tx) => {
      const { pricedItems, total } = await priceItems(
        tx,
        tenantId,
        mergedItems,
        { checkStock: false }
      );

      const depositAmount = requiresDeposit
        ? roundMoney((total * depositPercentage) / 100)
        : null;

      const newOrder = await tx.order.create({
        data: {
          tenantId,
          userId: null,
          origin: "BOT",
          status: "PENDING",
          paymentStatus: "PENDING",
          total,
          contactPhone,
          contactName,
          requiresDeposit,
          depositAmount,
          creationContext,
          orderItems: {
            create: pricedItems.map(({ variantId, quantity, price, note }) => ({
              variantId,
              quantity,
              price,
              note,
            })),
          },
        },
        ...orderItemsInclude,
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: newOrder.id,
          fromStatus: null,
          toStatus: "PENDING",
          note: "Pedido creado por el bot",
          changedById: null,
        },
      });

      return newOrder;
    });
  },
};
