import prisma from "../lib/prisma.js";
import { createError } from "../helpers/error.js";
import {
  getProductPrice,
  resolveProductStock,
  resolveVariantForProduct,
  roundMoney,
} from "../helpers/price.js";
import { sendMail, buildOrderStatusEmail } from "../lib/mailer.js";
import { logger } from "../lib/logger.js";
import { validateComboSelection } from "./combos.js";
import { getPromoTiersByProduct, pickPromoTier, applyPromoDiscount } from "./promos.js";

const log = logger.child({ module: "orders" });

// Solo trae las filas "padre" (líneas normales + línea de cada combo comprado)
// con sus hijos anidados (componentes elegidos dentro de un combo, price=0 —
// el cobro ya está en el padre). Ver docs/servicios/dominio/Combos.md.
const orderItemsInclude = {
  include: {
    orderItems: {
      where: { parentItemId: null },
      include: {
        product: true,
        variant: true,
        childItems: {
          include: {
            product: true,
            variant: true,
          },
        },
      },
    },
  },
};

/**
 * Valida una lista de items `{ productId, variantId?, quantity, note?, comboSelection? }`
 * contra el catálogo del tenant y resuelve el precio SERVER-SIDE. Devuelve los items con
 * precio y el total. Compartido por la creación desde carrito, la creación borrador del
 * bot y la revisión admin (no se duplica la validación ni el pricing). Corre dentro de
 * una transacción.
 *
 * `variantId` es opcional: si no viene, se resuelve la variante principal
 * (`isDefault`) del producto. Si el producto es COMBO, el item DEBE traer `comboSelection` (la
 * selección de UNA unidad de combo, `[{ productId, variantId?, quantity }]`) — se valida
 * contra la whitelist (`services/combos.js`) y se multiplica por `item.quantity`
 * (cantidad de combos comprados) para obtener `comboChildren`, que el caller inserta
 * como `OrderItem` hijos con `price: 0` (el cobro ya está en el padre, que cobra el
 * precio fijo del combo). Ver docs/servicios/dominio/Combos.md.
 *
 * @param {object}  tx                 cliente de transacción de Prisma
 * @param {number}  tenantId
 * @param {Array}   items              `[{ productId, variantId?, quantity, note?, comboSelection? }]`
 * @param {object}  [opts]
 * @param {boolean} [opts.checkStock]  si valida stock (carrito sí; bot a-pedido no)
 * @returns {Promise<{ pricedItems: Array, total: number }>}
 */
async function priceItems(tx, tenantId, items, { checkStock = true } = {}) {
  const productIds = items.map((i) => i.productId);
  const products = await tx.product.findMany({
    where: { id: { in: productIds }, tenantId },
    include: { variants: true },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  // Cantidad total por producto (sumando TODAS sus variantes), para resolver el
  // escalón de promo que corresponde — ver services/promos.js. Excluye COMBO (precio
  // fijo, no aplica). Se resuelve UNA vez para todo `items`, no por línea, así 2
  // líneas del mismo producto con distinta variante caen en el mismo balde.
  const qtyByProduct = new Map();
  for (const item of items) {
    const product = productMap.get(item.productId);
    if (product?.type !== "PRODUCTO") continue;
    qtyByProduct.set(item.productId, (qtyByProduct.get(item.productId) ?? 0) + item.quantity);
  }
  const promoTiersByProduct = qtyByProduct.size
    ? await getPromoTiersByProduct(tx, tenantId, [...qtyByProduct.keys()])
    : new Map();

  const pricedItems = [];
  for (const item of items) {
    const product = productMap.get(item.productId);

    if (!product) {
      throw createError("Producto no encontrado", "PRODUCT_NOT_FOUND", 404);
    }

    if (!product.isActive) {
      const error = createError(
        "Producto no disponible",
        "PRODUCT_NOT_AVAILABLE",
        400
      );
      error.details = { product: product.name };
      throw error;
    }

    let variant = null;
    if (product.type !== "COMBO") {
      variant = resolveVariantForProduct(product, item.variantId);
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
    }

    // Los combos no tienen stock propio: el chequeo de stock corre sobre los
    // componentes elegidos, más abajo (validateComboSelection).
    if (checkStock && product.type !== "COMBO") {
      const stock = resolveProductStock(product, variant) ?? 0;
      if (item.quantity > stock) {
        const error = createError(
          "Stock insuficiente",
          "INSUFFICIENT_STOCK",
          409
        );
        error.details = {
          productId: product.id,
          variant: variant?.id ?? null,
          solicitado: item.quantity,
          disponible: stock,
        };
        throw error;
      }
    }

    const price = getProductPrice(variant, product);
    if (price == null) {
      const error = createError(
        "Producto o variante sin precio",
        "PRODUCT_NO_PRICE",
        400
      );
      error.details = { productId: product.id };
      throw error;
    }

    let finalPrice = Number(price);
    if (product.type === "PRODUCTO") {
      const tiers = promoTiersByProduct.get(item.productId);
      const tier = tiers ? pickPromoTier(tiers, qtyByProduct.get(item.productId)) : null;
      if (tier) finalPrice = applyPromoDiscount(finalPrice, tier);
    }

    let comboChildren;
    if (product.type === "COMBO") {
      const perCombo = await validateComboSelection({
        tx,
        tenantId,
        comboProduct: product,
        selection: item.comboSelection,
        checkStock,
      });
      comboChildren = perCombo.map((child) => ({
        productId: child.productId,
        variantId: child.variantId,
        quantity: child.quantity * item.quantity,
      }));
    }

    pricedItems.push({
      productId: item.productId,
      variantId: variant?.id ?? null,
      quantity: item.quantity,
      price: finalPrice,
      note: item.note ?? null,
      comboChildren,
    });
  }

  const total = pricedItems.reduce((sum, it) => sum + it.price * it.quantity, 0);
  return { pricedItems, total };
}

/**
 * Inserta las filas de `OrderItem` para una orden ya creada: primero las
 * "padre" (líneas normales + una por combo comprado), y si alguna trae
 * `comboChildren` (ver `priceItems`), sus hijos con `parentItemId`. Se hace en
 * dos pasos porque los hijos necesitan el `id` autogenerado del padre.
 */
async function insertOrderItems(tx, orderId, pricedItems) {
  await tx.orderItem.createMany({
    data: pricedItems.map(({ productId, variantId, quantity, price, note }) => ({
      orderId,
      productId,
      variantId,
      quantity,
      price,
      note,
    })),
  });

  // Autoincrement + misma transacción: el orden de inserción coincide con el
  // orden ascendente de `id` para las filas recién creadas de esta orden.
  const createdItems = await tx.orderItem.findMany({
    where: { orderId },
    orderBy: { id: "asc" },
  });

  const childrenData = [];
  createdItems.forEach((created, index) => {
    for (const child of pricedItems[index].comboChildren ?? []) {
      childrenData.push({
        orderId,
        productId: child.productId,
        variantId: child.variantId,
        quantity: child.quantity,
        price: 0,
        parentItemId: created.id,
      });
    }
  });

  if (childrenData.length) {
    await tx.orderItem.createMany({ data: childrenData });
  }
}

// Stock real a validar/descontar al completar: siempre en ProductVariant.stock (todo
// PRODUCTO tiene su variantId ya resuelto desde `priceItems`/`cart.add`). COMBO no
// debería llegar acá (sus childItems ya reemplazan la línea padre en `stockLines`,
// ver `updateOrderStatus`) — no tiene `variantId`, así que esta función es un no-op
// para esa línea si por algún motivo llegara.
async function decrementLineStock(tx, line) {
  if (line.variantId == null) return;

  // Decremento condicional atómico: la fila solo baja si al momento del UPDATE
  // todavía hay stock suficiente (`stock >= quantity` en el WHERE). Es lo que
  // cierra la sobreventa por carrera: un chequeo previo sobre el snapshot leído
  // fuera de la transacción dejaba pasar dos COMPLETED simultáneos. Si `count`
  // es 0, no había stock -> se lanza y la transacción entera hace rollback.
  const { count } = await tx.productVariant.updateMany({
    where: { id: line.variantId, stock: { gte: line.quantity } },
    data: { stock: { decrement: line.quantity } },
  });

  if (count === 0) {
    const error = createError(
      "Stock insuficiente al completar la orden",
      "INSUFFICIENT_STOCK",
      409
    );
    error.details = {
      productId: line.productId,
      variant: line.variantId,
      solicitado: line.quantity,
    };
    throw error;
  }
}

export const OrderModel = {
  async create({
    tenantId,
    userId,
    fulfillmentMethod,
    addressText,
    addressLat,
    addressLng,
    addressDetails,
    paymentMethod,
    paymentNote,
  }) {
    const cart = await prisma.cart.findFirst({
      where: { userId, tenantId },
      include: { items: true },
    });

    if (!cart || cart.items.length === 0) {
      throw createError("El carrito está vacío", "EMPTY_CART", 400);
    }

    return prisma.$transaction(async (tx) => {
      const { pricedItems, total } = await priceItems(
        tx,
        tenantId,
        cart.items.map((item) => ({
          productId: item.productId,
          variantId: item.variantId ?? undefined,
          quantity: item.quantity,
          comboSelection: item.comboSelection ?? undefined,
        }))
      );

      const order = await tx.order.create({
        data: {
          tenantId,
          userId,
          total,
          status: "PENDING",
          fulfillmentMethod,
          addressText,
          addressLat,
          addressLng,
          addressDetails,
          paymentMethod,
          paymentNote,
        },
      });

      await insertOrderItems(tx, order.id, pricedItems);

      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: null,
          toStatus: "PENDING",
          note: "Pedido creado",
          changedById: userId,
        },
      });

      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

      return tx.order.findFirst({ where: { id: order.id }, ...orderItemsInclude });
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
              product: { name: { contains: search, mode: "insensitive" } },
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
      if (!order.fulfillmentMethod || !order.paymentMethod) {
        throw createError(
          "Falta completar método de entrega y/o de pago antes de producir",
          "FULFILLMENT_INCOMPLETE",
          409
        );
      }
      if (order.fulfillmentMethod === "DELIVERY" && !order.addressText) {
        throw createError(
          "Falta la dirección de entrega",
          "ADDRESS_MISSING",
          409
        );
      }
      if (
        ["TRANSFER", "MIXED"].includes(order.paymentMethod) &&
        !order.transferConfirmedAt
      ) {
        throw createError(
          "La transferencia debe estar confirmada antes de producir",
          "TRANSFER_NOT_CONFIRMED",
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

    // Líneas que representan stock REAL a validar/descontar: para un combo, sus
    // hijos (los componentes elegidos); para una línea normal, ella misma. El
    // combo-padre nunca tiene stock propio.
    const stockLines = order.orderItems.flatMap((item) =>
      item.childItems?.length ? item.childItems : [item]
    );

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.order.update({
        where: { id: orderId },
        data: { status, ...extraData },
        ...orderItemsInclude,
      });

      // El decremento es condicional (ver `decrementLineStock`): valida y baja el
      // stock en un solo UPDATE atómico. Si alguna línea no alcanza, lanza y toda
      // la transacción —incluido el cambio de status— hace rollback.
      if (status === "COMPLETED") {
        for (const line of stockLines) {
          await decrementLineStock(tx, line);
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
   * @param {object} [p.fulfillment] datos de entrega/pago a completar o
   *                                  corregir (típico en órdenes BOT, que
   *                                  nacen sin esto): fulfillmentMethod,
   *                                  addressText/Lat/Lng/Details,
   *                                  paymentMethod, paymentNote — todos
   *                                  opcionales, solo se tocan los que vienen.
   */
  async reviewOrder({
    tenantId,
    orderId,
    reviewedById,
    items = null,
    fulfillment = null,
  }) {
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

      if (fulfillment) {
        for (const key of [
          "fulfillmentMethod",
          "addressText",
          "addressLat",
          "addressLng",
          "addressDetails",
          "paymentMethod",
          "paymentNote",
        ]) {
          if (fulfillment[key] !== undefined) {
            data[key] = fulfillment[key];
          }
        }
      }

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
        // stock: la orden ya existe y es a-pedido. Para una línea de combo,
        // `comboSelection` se reconstruye a partir de sus hijos actuales
        // (per-unidad-de-combo) — v1 solo permite reescalar cantidades vía
        // review, no agregar/quitar componentes del combo (ver [[Combos]]).
        const desired = order.orderItems.map((it) => {
          const edit = items.find((e) => e.id === it.id);
          return {
            productId: it.productId,
            variantId: it.variantId ?? undefined,
            quantity: edit ? edit.quantity : it.quantity,
            // "note" in edit distingue "no la mandó" (mantener la actual) de
            // "la mandó en null" (borrarla).
            note: edit && "note" in edit ? edit.note : it.note,
            comboSelection: it.childItems?.length
              ? it.childItems.map((c) => ({
                  productId: c.productId,
                  variantId: c.variantId ?? undefined,
                  quantity: c.quantity / it.quantity,
                }))
              : undefined,
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
          const original = order.orderItems[index];
          await tx.orderItem.update({
            where: { id: original.id },
            data: { quantity: pi.quantity, price: pi.price, note: pi.note },
          });

          for (const child of pi.comboChildren ?? []) {
            const existingChild = original.childItems.find(
              (c) => c.productId === child.productId && c.variantId === child.variantId
            );
            if (existingChild) {
              await tx.orderItem.update({
                where: { id: existingChild.id },
                data: { quantity: child.quantity },
              });
            }
          }
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
   * Acción admin: confirma que la transferencia del pago llegó (la revisa un
   * asistente a mano, no hay verificación automática — el software no
   * gestiona el dinero). Independiente de `paymentStatus`/MercadoPago y de
   * la seña: solo aplica al método de pago TRANSFER/MIXED de esta orden.
   */
  async confirmTransfer({ tenantId, orderId, confirmedById }) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
    });

    if (!order) {
      throw createError("Orden no encontrada", "ORDER_NOT_FOUND", 404);
    }

    if (!["TRANSFER", "MIXED"].includes(order.paymentMethod)) {
      throw createError(
        "La orden no tiene transferencia pendiente de confirmar",
        "TRANSFER_NOT_APPLICABLE",
        409
      );
    }

    if (order.transferConfirmedAt) {
      throw createError(
        "La transferencia ya fue confirmada",
        "TRANSFER_ALREADY_CONFIRMED",
        409
      );
    }

    return prisma.order.update({
      where: { id: orderId },
      data: {
        transferConfirmedById: confirmedById,
        transferConfirmedAt: new Date(),
      },
      ...orderItemsInclude,
    });
  },

  /**
   * Creación de orden BORRADOR por el bot de WhatsApp. Origen BOT, sin revisar.
   * El bot solo propone `items` ya resueltos a `{ productId, variantId?, quantity,
   * note? }`; acá el server valida catálogo/precio y resuelve TODO lo monetario y
   * la seña. El bot nunca toca `paymentStatus`, `depositAmount` ni `tenantId`.
   *
   * @param {object} p
   * @param {number} p.tenantId        resuelto del phone_number_id, nunca del LLM
   * @param {Array}  p.items           `[{ productId, variantId?, quantity, note? }]`
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

    // Merge de items repetidos por producto+variante+nota: el bot podría proponer
    // el mismo producto en dos renglones. Solo se suma la cantidad si la nota
    // coincide (normalizada) — dos líneas con observaciones distintas (ej.
    // "sin nueces" vs "dedicatoria: Juan") deben quedar como filas separadas.
    const normalizeNote = (note) => (note ?? "").trim();
    const mergedMap = new Map();
    for (const it of items) {
      const note = normalizeNote(it.note);
      const key = `${it.productId}::${it.variantId ?? ""}::${note}`;
      const existing = mergedMap.get(key);
      mergedMap.set(key, {
        productId: it.productId,
        variantId: it.variantId ?? undefined,
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

      const order = await tx.order.create({
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
        },
      });

      await insertOrderItems(tx, order.id, pricedItems);

      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: null,
          toStatus: "PENDING",
          note: "Pedido creado por el bot",
          changedById: null,
        },
      });

      return tx.order.findFirst({ where: { id: order.id }, ...orderItemsInclude });
    });
  },
};
