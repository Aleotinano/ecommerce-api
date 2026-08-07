import prisma from "../lib/prisma.js";
import { createError } from "../helpers/error.js";
import {
  getProductPrice,
  resolveProductStock,
  resolveVariantForProduct,
  roundMoney,
} from "../helpers/price.js";
import { sendMail, buildOrderStatusEmail } from "../lib/mailer.js";
import { normalizeCustomerPhone } from "../lib/phone.js";
import { logger } from "../lib/logger.js";
import { validateComboSelection } from "./combos.js";
import {
  CashRegisterModel,
  hasCashChannels,
  recordOrderPayments,
} from "./cash-register.js";
import { getPromoTiersByProduct, pickPromoTier, applyPromoDiscount } from "./promos.js";
import { invalidateProductsCache } from "./productos.js";
import {
  applyAutoAdvance,
  assertCanProduce,
  assertTransition,
  derivePaymentStatus,
  MONEY_EPS,
  paymentSummary,
  pendingByChannel,
  PRODUCTION_STATUSES,
} from "./order-state.js";
import { getStatusMeta, ORDER_STATUS_CODES } from "./order-status.js";
import { buildOrdersXlsx, ordersFileName } from "./orders-export.js";

const log = logger.child({ module: "orders" });

/**
 * El `where` del listado del backoffice, en un solo lugar: lo usan el listado
 * (`getUserOrders`), el contador por estado (`getStatusCounts`) y la planilla
 * (`getOrdersForExport`). Separarlos sería aceptar que una búsqueda muestre un
 * conjunto de órdenes, cuente otro y exporte un tercero.
 *
 * `from`/`to` los manda solo el export: el listado y los contadores no filtran
 * por fecha (ver `orderExportQuery` en schemas/order.schema.js).
 *
 * `includeArchived` es **false por defecto** a propósito: el tablero muestra el día
 * en curso, y lo archivado es justamente lo que ya no tiene que estorbar ahí. La
 * única que lo pide en `true` es la planilla — un reporte de un día que se saltee
 * las órdenes archivadas de ese día sale vacío.
 */
function buildAdminOrdersWhere({
  tenantId,
  status,
  search,
  from,
  to,
  includeArchived = false,
}) {
  const where = { tenantId };

  if (!includeArchived) {
    where.archivedAt = null;
  }

  if (status) {
    where.status = status;
  }

  if (from || to) {
    where.createdAt = {
      ...(from && { gte: from }),
      ...(to && { lte: to }),
    };
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

  return where;
}

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
    // El libro de cobros viaja con la orden en todas partes: es lo que le permite
    // al motor (services/order-state.js) responder con montos reales en vez de
    // estimar desde los sellos. Son pocas filas por orden — el costo es marginal
    // al lado de tener que recordar incluirlo en cada query.
    payments: { orderBy: { confirmedAt: "asc" } },
    // Solo el CONTEO de comprobantes vivos, no las filas: alcanza para que el
    // motor diga "hay 2 comprobantes sin revisar" en el blocker de transferencia, y
    // las filas (con su URL firmada, que hay que emitir de nuevo cada vez) solo se
    // traen cuando alguien pide el detalle. Ver services/order-receipts.js.
    _count: { select: { receipts: { where: { deletedAt: null } } } },
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

/**
 * Aviso al cliente de que su pedido cambió de estado. Best-effort: la orden ya
 * quedó confirmada en DB, así que un problema mandando el mail no puede tumbar
 * la operación. Se llama SIEMPRE fuera de la transacción.
 */
async function sendStatusEmail({ orderId, status, email, tenantName }) {
  if (!email) return;

  try {
    const { subject, text, html } = buildOrderStatusEmail({
      orderId,
      status,
      tenantName,
    });
    await sendMail({ to: email, subject, text, html });
  } catch (error) {
    log.error(
      { err: error, orderId, status },
      "no se pudo enviar el email de cambio de estado"
    );
  }
}

/**
 * Notifica un avance AUTOMÁTICO (ver `applyAutoAdvance`). Las acciones que lo
 * disparan —revisión, confirmación de cobro— no cargan al usuario ni al tenant,
 * así que se traen acá y solo cuando la orden efectivamente avanzó: para el
 * cliente es el mismo mail de siempre, no importa quién movió el estado.
 */
async function notifyAutoAdvance(orderId, status) {
  const info = await prisma.order.findFirst({
    where: { id: orderId },
    select: {
      user: { select: { email: true } },
      tenant: { select: { name: true } },
    },
  });

  await sendStatusEmail({
    orderId,
    status,
    email: info?.user?.email,
    tenantName: info?.tenant?.name,
  });
}

/**
 * Corazón del cobro: anota filas en el libro (`OrderPayment`), deja la orden
 * consistente y la avanza si corresponde. **Todo en una sola transacción**, que es
 * lo que hace que no exista el estado intermedio "cobré pero no lo registré".
 *
 * Los tres pasos van juntos a propósito:
 *   1. las filas del cobro,
 *   2. `paymentStatus` recalculado DESDE esas filas (la columna es un cache, ver
 *      `derivePaymentStatus`) más los sellos que traiga el caller,
 *   3. el avance automático, si el cobro era lo último que faltaba.
 *
 * @param {Array}  p.entries  filas a crear `[{ kind, channel, amount, note? }]`.
 *                            Puede venir vacío: confirmar algo ya cobrado no crea
 *                            una fila duplicada, pero igual sella y reevalúa.
 * @param {object} [p.extraData] campos de la orden a sellar en el mismo update
 * @param {number[]} [p.linkReceiptIds] comprobantes que respaldan ESTE cobro (ver
 *                            services/order-receipts.js). Se enlazan adentro de la
 *                            misma transacción: "lo cobré" y "esto es lo que miré
 *                            para darlo por cobrado" entran juntos o no entran.
 */
async function applyPayments({
  tenantId,
  order,
  entries = [],
  actorId,
  extraData = {},
  linkReceiptIds = [],
}) {
  const orderId = order.id;

  // Apertura automática ANTES de la transacción, no adentro: si dos cobros
  // simultáneos intentaran abrir el turno, el índice único parcial haría fallar a
  // uno, y en Postgres un error dentro de la transacción la aborta entera. Acá el
  // choque se resuelve leyendo el turno que ganó (ver `ensureScheduledSession`) y el
  // cobro sigue su camino.
  if (hasCashChannels(entries)) {
    await CashRegisterModel.ensureScheduledSession({ tenantId, actorId });
  }

  const { order: result, advancedTo } = await prisma.$transaction(async (tx) => {
    // `createManyAndReturn` y no `createMany` porque la caja necesita el `id` de
    // cada fila: es lo que hace que un cobro no pueda anotarse dos veces en el
    // arqueo (ver `recordOrderPayments`).
    const creadas = entries.length
      ? await tx.orderPayment.createManyAndReturn({
          data: entries.map((entry) => ({
            tenantId,
            orderId,
            kind: entry.kind,
            channel: entry.channel,
            amount: roundMoney(Number(entry.amount)),
            note: entry.note ?? null,
            confirmedById: actorId ?? null,
          })),
        })
      : [];

    // Adentro de esta transacción a propósito: con la caja habilitada y sin turno
    // abierto esto lanza, y el cobro NO queda sellado.
    if (creadas.length) {
      await recordOrderPayments(tx, { tenantId, orderId, payments: creadas, actorId });
    }

    // El comprobante queda apuntando a la fila del libro que respalda. Si el monto
    // dio 0 no se creó ninguna fila (la transferencia ya estaba cubierta por la
    // seña, por ejemplo): ahí el comprobante se queda colgado de la ORDEN con
    // `orderPaymentId: null`, que es lo correcto — hay evidencia, pero no hay un
    // cobro nuevo al cual atarla.
    if (creadas.length && linkReceiptIds.length) {
      await tx.orderReceipt.updateMany({
        where: { id: { in: linkReceiptIds }, tenantId, orderId },
        data: { orderPaymentId: creadas[0].id },
      });
    }

    const payments = await tx.orderPayment.findMany({ where: { orderId } });

    const updated = await tx.order.update({
      where: { id: orderId },
      data: { ...extraData, paymentStatus: derivePaymentStatus(order, payments) },
      ...orderItemsInclude,
    });

    return applyAutoAdvance(tx, updated, { actorId });
  });

  if (advancedTo) await notifyAutoAdvance(orderId, advancedTo);

  return result;
}

/**
 * Valida que el método pedido esté HABILITADO para el tenant.
 *
 * Los enums de `schemas/order.schema.js` son los valores posibles del sistema;
 * estas listas son los que este tenant acepta (`TenantConfig`, seteado desde un
 * perfil — ver `services/tenant-profiles.js`). La validación no puede vivir en Zod
 * porque Zod no conoce el tenant, así que vive acá, al lado del otro invariante de
 * pago (`PAYMENT_AMOUNTS_MISMATCH`).
 *
 * Una lista vacía o ausente se trata como "todo habilitado": es lo que había antes
 * de que estas columnas existieran, y evita que una config a medio migrar deje al
 * tenant sin poder vender.
 *
 * @param {string[]|null|undefined} enabled
 * @param {string} requested
 * @param {"PAYMENT"|"FULFILLMENT"} kind
 */
function assertMethodEnabled(enabled, requested, kind) {
  if (!Array.isArray(enabled) || enabled.length === 0) return;
  if (enabled.includes(requested)) return;

  const config = {
    PAYMENT: {
      code: "PAYMENT_METHOD_NOT_ENABLED",
      message: "El método de pago no está habilitado para esta tienda",
    },
    FULFILLMENT: {
      code: "FULFILLMENT_METHOD_NOT_ENABLED",
      message: "La forma de entrega no está habilitada para esta tienda",
    },
  }[kind];

  const error = createError(config.message, config.code, 400);
  // El panel (y el storefront) necesitan poder decir qué SÍ se puede, no solo que
  // esto no.
  error.details = { pedido: requested, habilitados: enabled };
  throw error;
}

/**
 * Por qué vía entró la plata. Se deriva del método pactado cuando no hay
 * ambigüedad; con `MIXED` —o con una orden que todavía no tiene método definido,
 * el estado normal de un pedido del bot sin revisar— hay que decirlo.
 *
 * Adivinar acá es lo que después hace que un arqueo no cierre y nadie sepa por
 * qué, así que se prefiere un 400 explícito antes que un canal inventado.
 */
function resolvePaymentChannel(order, explicit) {
  if (explicit) return explicit;
  if (order.paymentMethod === "CASH") return "CASH";
  if (order.paymentMethod === "TRANSFER") return "TRANSFER";

  throw createError(
    "Falta indicar por qué vía entró la plata (efectivo o transferencia)",
    "PAYMENT_CHANNEL_REQUIRED",
    400
  );
}

/**
 * Filas necesarias para dar por saldada una orden: **lo que falta**, repartido por
 * vía. Devuelve `[]` si ya estaba cobrada (confirmar de nuevo no duplica el cobro).
 *
 * Con `MIXED` sale una fila por cada vía que todavía deba plata. Si el desglose no
 * alcanza a cubrir el remanente —montos viejos que no cierran contra el total— se
 * cae al canal indicado explícitamente, y si no vino, al 400 de
 * `resolvePaymentChannel`. Nunca se inventa la vía.
 */
function buildSettlementEntries(order, channel) {
  const { pending } = paymentSummary(order);
  if (pending <= 0) return [];

  if (order.paymentMethod === "MIXED") {
    const falta = pendingByChannel(order);
    const entries = [];

    if (falta.CASH > 0) {
      entries.push({ kind: "PAYMENT", channel: "CASH", amount: falta.CASH });
    }
    if (falta.TRANSFER > 0) {
      entries.push({ kind: "PAYMENT", channel: "TRANSFER", amount: falta.TRANSFER });
    }
    if (entries.length) return entries;
  }

  return [
    {
      kind: "PAYMENT",
      channel: resolvePaymentChannel(order, channel),
      amount: pending,
    },
  ];
}

/**
 * Resuelve con qué teléfono se guarda una orden.
 *
 * Precedencia: lo que se tipeó en este checkout gana sobre lo que el cliente
 * tenga guardado, porque alguien puede estar encargando para la casa de la madre
 * y querer que llamen a otro número. El de la cuenta es el fallback.
 *
 * @returns {{ phone: string|null, saveToUser: boolean }} `saveToUser` marca que
 *   el cliente no tenía teléfono y este hay que dejárselo guardado, para que la
 *   próxima vez el checkout venga prellenado.
 */
function resolveContactPhone({ typed, stored, config, enforce, require: alwaysRequire }) {
  const policy = {
    country: config?.customerPhoneCountry ?? "54",
    area: config?.customerPhoneArea ?? null,
  };

  // `enforce` es falso para las órdenes que carga un admin a mano: quien las
  // carga tiene al cliente al teléfono en ese mismo momento, y el panel todavía
  // no tiene el campo. Bloquearlas sería frenar el trabajo por un dato que esa
  // pantalla no puede dar. El número se completa después, en la revisión.
  //
  // `require` pisa la política del tenant y es para el checkout de invitado: sin
  // cuenta, el teléfono es el ÚNICO dato de contacto que queda. Un tenant con
  // `customerPhoneMode: "off"` puede permitírselo porque tiene el mail y el
  // historial de la cuenta; con un invitado, un pedido sin teléfono es un pedido
  // que nadie puede confirmar.
  const mode = alwaysRequire
    ? "required"
    : enforce
      ? (config?.customerPhoneMode ?? "required")
      : "optional";

  if (mode === "off") return { phone: null, saveToUser: false };

  const typedRaw = typeof typed === "string" ? typed.trim() : "";

  if (typedRaw) {
    const normalized = normalizeCustomerPhone(typedRaw, policy);
    if (!normalized) {
      // Se avisa en vez de guardar algo inservible: un número mal cargado es
      // indistinguible de no tener número cuando hay que llamar.
      throw createError(
        "El teléfono no parece válido. Revisá que tenga característica y número.",
        "INVALID_CONTACT_PHONE",
        400
      );
    }
    return { phone: normalized, saveToUser: !stored };
  }

  if (stored) return { phone: stored, saveToUser: false };

  if (mode === "required") {
    throw createError(
      "Hace falta un teléfono de contacto para confirmar el pedido",
      "CONTACT_PHONE_REQUIRED",
      400
    );
  }

  return { phone: null, saveToUser: false };
}

export const OrderModel = {
  /**
   * Checkout: convierte el carrito del usuario en una orden NEW.
   *
   * Los items NO los manda el cliente: se leen del carrito del server y se
   * pricean acá (`priceItems`). El cliente solo aporta cómo recibe el pedido y
   * cómo lo paga.
   *
   * @param {object} p
   * @param {number|null} [p.userId] atajo para el caso logueado; equivale a
   *   `cartOwner: { userId, guestId: null }`. Lo usan la ruta de admin y los tests.
   * @param {{ userId: number|null, guestId: string|null }} [p.cartOwner] dueño del
   *   carrito a convertir. Con `userId` es un cliente logueado; con `guestId` es
   *   un invitado (cookie httpOnly, mismo par que usa el carrito). La orden que
   *   sale de un carrito de invitado queda con `userId: null` — la columna lo
   *   admite desde siempre, igual que los drafts del bot.
   * @param {string} [p.origin="ADMIN"] procedencia de la orden. Las que llegan
   *   por `/store/orders` son "STORE" y quedan sujetas al guard de revisión
   *   (ver updateOrderStatus); las que carga un admin a mano son "ADMIN".
   * @param {string|null} [p.contactPhone] tal cual lo tipeó la persona; se
   *   normaliza acá contra la característica del tenant. Obligatorio si es un
   *   invitado, igual que `contactName`.
   */
  async create({
    tenantId,
    userId,
    cartOwner,
    origin = "ADMIN",
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
  }) {
    // `cartOwner` gana; `userId` suelto queda como atajo retrocompatible.
    const owner = cartOwner ?? { userId: userId ?? null, guestId: null };
    const ownerId = owner.userId ?? null;
    const guestId = owner.guestId ?? null;
    const isGuest = ownerId == null;

    // Mismo par de dueños que resuelve el carrito (middleware/guestCart.js): con
    // sesión se busca por userId, sin sesión por el guestId de la cookie.
    //
    // El corte por `guestId` vacío NO es defensivo de más: los carritos de los
    // usuarios logueados tienen `guestId: null`, así que un `where: { guestId: null }`
    // matchearía el carrito de cualquier otro cliente. `resolveCartOwner` siempre
    // emite la cookie, pero esto no puede depender de que el middleware corra.
    const cart =
      isGuest && !guestId
        ? null
        : await prisma.cart.findFirst({
            where: isGuest
              ? { guestId, tenantId }
              : { userId: ownerId, tenantId },
            include: { items: true },
          });

    if (!cart || cart.items.length === 0) {
      throw createError("El carrito está vacío", "EMPTY_CART", 400);
    }

    // Contacto: se resuelve ANTES de abrir la transacción para que un teléfono
    // faltante o ilegible corte el checkout sin haber tocado stock ni carrito.
    const [config, user] = await Promise.all([
      prisma.tenantConfig.findUnique({
        where: { tenantId },
        select: {
          customerPhoneMode: true,
          customerPhoneCountry: true,
          customerPhoneArea: true,
          // Flujo de venta del tenant: qué métodos acepta y si cobra seña. Viaja
          // en este mismo round-trip, que ya existía para el teléfono.
          paymentMethodsEnabled: true,
          fulfillmentMethodsEnabled: true,
          depositEnabled: true,
          depositPercentage: true,
        },
      }),
      // Sin usuario no hay a quién buscar: `findUnique({ where: { id: undefined } })`
      // revienta en Prisma.
      isGuest
        ? null
        : prisma.user.findUnique({
            where: { id: ownerId },
            select: { phone: true, username: true },
          }),
    ]);

    const { phone: resolvedPhone, saveToUser } = resolveContactPhone({
      typed: contactPhone,
      stored: user?.phone ?? null,
      config,
      enforce: origin === "STORE",
      require: isGuest,
    });

    const resolvedName =
      (typeof contactName === "string" && contactName.trim()) ||
      user?.username ||
      null;

    // El logueado tiene el username de respaldo; el invitado no tiene nada, y una
    // orden sin nombre no se puede ni buscar ni entregar.
    if (isGuest && !resolvedName) {
      throw createError(
        "Hace falta un nombre para confirmar el pedido",
        "CONTACT_NAME_REQUIRED",
        400
      );
    }

    // Antes de la transacción a propósito: un método no habilitado tiene que
    // cortar el checkout sin haber tocado stock ni vaciado el carrito.
    assertMethodEnabled(config?.paymentMethodsEnabled, paymentMethod, "PAYMENT");
    assertMethodEnabled(
      config?.fulfillmentMethodsEnabled,
      fulfillmentMethod,
      "FULFILLMENT"
    );

    // La seña del tenant se respeta también en el checkout web. Antes solo la
    // resolvían `createDraft` (bot) y `reviewOrder`, así que una orden creada por
    // `/store/orders` salía con `requiresDeposit: false` aunque el tenant cobrara
    // seña, y esquivaba el guard `DEPOSIT_NOT_CONFIRMED` del motor.
    const requiresDeposit = config?.depositEnabled ?? false;
    const depositPercentage = config?.depositPercentage ?? 50;

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

      // El desglose del pago mixto se valida contra el total que acabamos de
      // calcular, no contra uno que mande el cliente. Zod ya garantizó que
      // ambos montos estén presentes y sean > 0 si el método es MIXED.
      if (paymentMethod === "MIXED") {
        const suma = roundMoney(Number(cashAmount) + Number(transferAmount));
        if (suma !== roundMoney(total)) {
          const error = createError(
            "La suma de efectivo y transferencia debe igualar el total del pedido",
            "PAYMENT_AMOUNTS_MISMATCH",
            400
          );
          error.details = { total: roundMoney(total), suma };
          throw error;
        }
      }

      const order = await tx.order.create({
        data: {
          tenantId,
          userId: ownerId,
          total,
          status: "NEW",
          origin,
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
          // Snapshot histórico, mismo criterio que las columnas addressX: si el
          // cliente después cambia su teléfono, esta orden conserva el que dio
          // cuando la hizo.
          contactPhone: resolvedPhone,
          contactName: resolvedName,
          // Snapshot pactado, igual que en `createDraft`: no se recalcula después
          // desde TenantConfig, así que cambiar el porcentaje no altera órdenes ya
          // tomadas.
          requiresDeposit,
          depositAmount: requiresDeposit
            ? roundMoney((total * depositPercentage) / 100)
            : null,
        },
      });

      // Se le guarda al cliente el teléfono que acaba de dar, para que el
      // próximo checkout venga prellenado. Solo si no tenía: el número por
      // pedido no pisa el de la cuenta. El invitado no tiene cuenta donde
      // guardarlo (y `saveToUser` le da true, porque nunca tuvo un `stored`).
      if (!isGuest && saveToUser && resolvedPhone) {
        await tx.user.update({
          where: { id: ownerId },
          data: { phone: resolvedPhone },
        });
      }

      await insertOrderItems(tx, order.id, pricedItems);

      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: null,
          toStatus: "NEW",
          note: "Pedido creado",
          // null si lo hizo un invitado: la columna lo admite y el "quién" ya
          // queda en contactName/contactPhone de la orden.
          changedById: ownerId,
        },
      });

      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

      // El config del tenant viene en el mismo round-trip: el controller lo
      // necesita para armar el deep-link de WhatsApp (lib/whatsapp-link.js).
      return tx.order.findFirst({
        where: { id: order.id },
        include: {
          ...orderItemsInclude.include,
          tenant: {
            select: {
              config: {
                select: {
                  currency: true,
                  socialWhatsapp: true,
                  contactPhone: true,
                },
              },
            },
          },
        },
      });
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
    return prisma.order.findMany({
      where: buildAdminOrdersWhere({ tenantId, status, search }),
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

  /**
   * Las órdenes de un rango, enteras y sin paginar: la fuente de la planilla.
   *
   * Va en orden **cronológico** (al revés que el listado) porque un reporte se
   * lee de la primera a la última, y trae el mismo `include` que el listado —el
   * libro de cobros incluido— para que el motor pueda calcular cuánto entró de
   * cada orden sin una segunda consulta.
   *
   * El tope es una red de contención, no una paginación: sin `from`/`to` esto
   * es "toda la historia del tenant", y una planilla de cien mil filas no la
   * abre nadie. En la práctica el admin pide un día.
   */
  async getOrdersForExport({ tenantId, status, search, from, to, limit = 5000 }) {
    return prisma.order.findMany({
      // Con las archivadas: la planilla es el día entero, y al cerrar el turno TODO
      // lo terminal de ese día queda archivado. Sin esto, "el Excel de hoy" bajado
      // después del cierre traería solo las órdenes que quedaron abiertas.
      where: buildAdminOrdersWhere({
        tenantId,
        status,
        search,
        from,
        to,
        includeArchived: true,
      }),
      include: {
        user: { select: { id: true, username: true, email: true } },
        ...orderItemsInclude.include,
      },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  },

  /** La planilla del rango: las órdenes con su detalle, lista para descargar. */
  async exportOrders({ tenantId, status, search, from, to }) {
    const [orders, config] = await Promise.all([
      this.getOrdersForExport({ tenantId, status, search, from, to }),
      prisma.tenantConfig.findUnique({
        where: { tenantId },
        select: { storeName: true, currency: true },
      }),
    ]);

    const buffer = await buildOrdersXlsx({
      orders,
      range: { from: from ?? null, to: to ?? null },
      storeName: config?.storeName ?? null,
      currency: config?.currency ?? "ARS",
    });

    return { buffer, filename: ordersFileName({ from, to }) };
  },

  /**
   * Cuántas órdenes hay por estado, para los encabezados del tablero.
   *
   * Va aparte del listado y no como un total en su respuesta porque el tablero
   * pide una tanda POR COLUMNA: el número de "Entregadas 50" no sale de contar
   * lo que se trajo, sino de la base. Comparte el `where` con `getUserOrders`,
   * así una búsqueda no puede filtrar las cards de una forma y contarlas de
   * otra.
   *
   * Es también donde **rueda el día**. `ensureScheduledSession` es lo que cierra el
   * turno vencido —y ese cierre es lo que archiva las órdenes terminales—, pero se
   * resuelve en el momento y hasta acá solo lo llamaban `GET /cash-register/current`
   * y el enganche de cobros. Un local que no entra a la pantalla de Caja nunca vería
   * limpiarse el tablero. Este es el otro momento en que alguien "toca" el negocio.
   *
   * Va en los contadores y no en el listado porque el tablero pide los contadores
   * UNA vez por carga y el listado una vez POR COLUMNA.
   */
  async getStatusCounts({ tenantId, search, actorId = null }) {
    // En try/catch y no `await` pelado: un problema de caja no puede tumbar el
    // listado de órdenes. Si el turno no rueda hoy, rueda en la próxima carga.
    try {
      await CashRegisterModel.ensureScheduledSession({ tenantId, actorId });
    } catch (error) {
      log.warn(
        { err: error, tenantId },
        "No se pudo resolver el turno de caja al contar órdenes"
      );
    }

    const rows = await prisma.order.groupBy({
      by: ["status"],
      where: buildAdminOrdersWhere({ tenantId, search }),
      _count: { _all: true },
    });

    // Todos los códigos presentes aunque no tengan filas: el front no tiene que
    // defenderse de una clave faltante para pintar una columna vacía.
    const counts = Object.fromEntries(
      ORDER_STATUS_CODES.map((code) => [code, 0])
    );
    for (const row of rows) {
      counts[row.status] = row._count._all;
    }

    return counts;
  },

  /**
   * Cambio de estado PEDIDO A MANO (o por el webhook de MercadoPago). Las
   * precondiciones ya no viven acá: las resuelve `services/order-state.js`, que
   * es el mismo módulo que usa el avance automático. Esta función solo valida la
   * transición, aplica los efectos (stock, cache, mail) y registra el historial.
   *
   * @param {string} [p.trigger="MANUAL"] quién lo pidió, para el historial:
   *   MANUAL (una persona) o GATEWAY (el webhook de MercadoPago). El avance
   *   automático no pasa por acá, escribe AUTO desde `applyAutoAdvance`.
   */
  async updateOrderStatus({
    tenantId,
    orderId,
    status,
    extraData = {},
    changedById = null,
    note = null,
    trigger = "MANUAL",
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

    // Pedir el estado que la orden ya tiene no es un error: es un doble click.
    // Se responde la orden sin registrar nada, igual que siempre.
    if (order.status === status) {
      return order;
    }

    assertTransition(order, status);

    // Guard de "bueno para producir". CANCELLED queda libre: siempre se puede
    // cancelar. El detalle de qué se exige está en `services/order-state.js`,
    // que es la misma fuente que consulta el panel para saber qué falta ANTES de
    // apretar el botón.
    if (PRODUCTION_STATUSES.includes(status)) {
      assertCanProduce(order);
    }

    const recordHistory = (tx) =>
      tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: order.status,
          toStatus: status,
          // Sin nota propia va la del catálogo (services/order-status.js). Antes
          // ese default lo mandaba el panel en cada PATCH: una tabla de textos del
          // dominio viviendo en el cliente, y que el bot y los scripts no tenían
          // —sus transiciones quedaban con el timeline mudo.
          note: note ?? getStatusMeta(status).historyNote,
          changedById,
          trigger,
        },
      });

    // Líneas que representan stock REAL a validar/descontar: para un combo, sus
    // hijos (los componentes elegidos); para una línea normal, ella misma. El
    // combo-padre nunca tiene stock propio.
    const stockLines = order.orderItems.flatMap((item) =>
      item.childItems?.length ? item.childItems : [item]
    );

    // Entregar es cobrar: una orden que se completa sin nada pendiente en el libro
    // dejaba la plata sin registrar (típico del efectivo, donde no hay ninguna
    // confirmación previa que la anote) y esa plata no iba a aparecer en el arqueo
    // de Caja. `buildSettlementEntries` devuelve lo que FALTA, repartido por vía,
    // y `[]` si ya estaba saldada — así una orden cobrada antes no se cobra dos
    // veces, y las de MercadoPago no se tocan.
    //
    // No hace falta pasarle un canal: `assertCanProduce` ya corrió recién y
    // `FULFILLMENT_INCOMPLETE` bloquea cualquier orden sin `paymentMethod`, así que
    // acá el canal siempre es derivable.
    const settlement =
      status === "COMPLETED"
        ? buildSettlementEntries(order).map((entry) => ({
            ...entry,
            note: "Cobro registrado al completar la orden",
          }))
        : [];

    // Mismo motivo que en `applyPayments`: el turno se abre antes de la transacción.
    if (hasCashChannels(settlement)) {
      await CashRegisterModel.ensureScheduledSession({ tenantId, actorId: changedById });
    }

    const updated = await prisma.$transaction(async (tx) => {
      // El decremento es condicional (ver `decrementLineStock`): valida y baja el
      // stock en un solo UPDATE atómico. Si alguna línea no alcanza, lanza y toda
      // la transacción —incluido el cambio de status— hace rollback.
      if (status === "COMPLETED") {
        for (const line of stockLines) {
          await decrementLineStock(tx, line);
        }
      }

      if (settlement.length) {
        // Ver `applyPayments`: se devuelven las filas creadas para que la caja
        // pueda anotar un movimiento por cada una. Este es el segundo (y último)
        // camino que escribe en el libro, y el que hace que el efectivo del
        // mostrador llegue al arqueo.
        const creadas = await tx.orderPayment.createManyAndReturn({
          data: settlement.map((entry) => ({
            tenantId,
            orderId,
            kind: entry.kind,
            channel: entry.channel,
            amount: roundMoney(Number(entry.amount)),
            note: entry.note,
            confirmedById: changedById,
          })),
        });

        await recordOrderPayments(tx, {
          tenantId,
          orderId,
          payments: creadas,
          actorId: changedById,
        });
      }

      // Se relee el libro (en vez de razonar sobre `settlement`) por el mismo
      // motivo que en `applyPayments`: `paymentStatus` es un cache de lo que hay
      // escrito, no de lo que este caller creía que iba a escribir.
      const payments = settlement.length
        ? await tx.orderPayment.findMany({ where: { orderId } })
        : order.payments;

      const result = await tx.order.update({
        where: { id: orderId },
        data: {
          ...extraData,
          status,
          paymentStatus: derivePaymentStatus(order, payments),
          ...(settlement.length
            ? { paymentConfirmedById: changedById, paymentConfirmedAt: new Date() }
            : {}),
        },
        ...orderItemsInclude,
      });

      await recordHistory(tx);

      return result;
    });

    // COMPLETED bajó `ProductVariant.stock`: el catálogo cacheado (`prod:*`, TTL
    // 180 s) quedaría mostrando stock viejo — y con `showOutOfStock=false` eso es
    // un producto agotado que el cliente sigue viendo. Mismo criterio que el resto
    // de las escrituras: invalidar en el write, no esperar al TTL.
    if (status === "COMPLETED") {
      await invalidateProductsCache(tenantId);
    }

    await sendStatusEmail({
      orderId,
      status,
      email: order.user?.email,
      tenantName: order.tenant?.name,
    });

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
   *                                  addressText/Lat/Lng/Details/MapsUrl,
   *                                  paymentMethod, paymentNote,
   *                                  cashAmount/transferAmount — todos
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

    if (order.status !== "NEW") {
      throw createError(
        "Solo se puede revisar una orden nueva",
        "ORDER_NOT_NEW",
        409
      );
    }

    const hasEdits = Array.isArray(items) && items.length > 0;

    // Config del tenant, en una sola lectura: la característica telefónica (para
    // normalizar un número cargado a mano, igual que en el checkout), los métodos
    // habilitados y el porcentaje de seña. Antes eran dos queries condicionales
    // dentro y fuera de la transacción; el review siempre necesita al menos los
    // métodos, así que se trae una vez y se usa en los tres lugares.
    const flowConfig = await prisma.tenantConfig.findUnique({
      where: { tenantId },
      select: {
        customerPhoneCountry: true,
        customerPhoneArea: true,
        paymentMethodsEnabled: true,
        fulfillmentMethodsEnabled: true,
        depositPercentage: true,
      },
    });

    const { order: reviewed, advancedTo } = await prisma.$transaction(async (tx) => {
      const data = { reviewedById, reviewedAt: new Date() };

      if (fulfillment) {
        for (const key of [
          "fulfillmentMethod",
          "addressText",
          "addressLat",
          "addressLng",
          "addressDetails",
          "addressMapsUrl",
          "paymentMethod",
          "paymentNote",
          "cashAmount",
          "transferAmount",
          "contactName",
        ]) {
          if (fulfillment[key] !== undefined) {
            data[key] = fulfillment[key];
          }
        }

        // El teléfono no entra por el whitelist de arriba: es el único campo del
        // bloque que se guarda transformado, no tal cual vino. Es la vía por la
        // que se completan las órdenes viejas, que nacieron sin número.
        if (fulfillment.contactPhone !== undefined) {
          if (fulfillment.contactPhone === null) {
            data.contactPhone = null;
          } else {
            const normalized = normalizeCustomerPhone(fulfillment.contactPhone, {
              country: flowConfig?.customerPhoneCountry ?? "54",
              area: flowConfig?.customerPhoneArea ?? null,
            });
            if (!normalized) {
              throw createError(
                "El teléfono no parece válido. Revisá que tenga característica y número.",
                "INVALID_CONTACT_PHONE",
                400
              );
            }
            data.contactPhone = normalized;
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
          const pct = flowConfig?.depositPercentage ?? 50;
          data.depositAmount = roundMoney((total * pct) / 100);
        }
      }

      // Mismo invariante que en `create`, sobre el estado RESULTANTE: el review
      // puede haber cambiado el método de pago, los montos y/o el total (si
      // corrigió cantidades), y las tres cosas tienen que cerrar entre sí.
      const finalPaymentMethod = data.paymentMethod ?? order.paymentMethod;
      const finalFulfillmentMethod =
        data.fulfillmentMethod ?? order.fulfillmentMethod;

      // El review es la otra puerta por la que se elige método (típico en las
      // órdenes del bot, que nacen sin ninguno), así que necesita el mismo guard
      // que el checkout.
      if (finalPaymentMethod) {
        assertMethodEnabled(
          flowConfig?.paymentMethodsEnabled,
          finalPaymentMethod,
          "PAYMENT"
        );
      }
      if (finalFulfillmentMethod) {
        assertMethodEnabled(
          flowConfig?.fulfillmentMethodsEnabled,
          finalFulfillmentMethod,
          "FULFILLMENT"
        );
      }

      if (finalPaymentMethod === "MIXED") {
        const finalTotal = data.total ?? order.total;
        const finalCash = data.cashAmount ?? order.cashAmount;
        const finalTransfer = data.transferAmount ?? order.transferAmount;

        if (finalCash == null || finalTransfer == null) {
          throw createError(
            "El pago mixto necesita cashAmount y transferAmount",
            "PAYMENT_AMOUNTS_MISSING",
            400
          );
        }

        const suma = roundMoney(Number(finalCash) + Number(finalTransfer));
        if (suma !== roundMoney(finalTotal)) {
          const error = createError(
            "La suma de efectivo y transferencia debe igualar el total del pedido",
            "PAYMENT_AMOUNTS_MISMATCH",
            400
          );
          error.details = { total: roundMoney(finalTotal), suma };
          throw error;
        }
      } else if (finalPaymentMethod != null) {
        // Al salir de MIXED (ej. el cliente pagó todo en efectivo) los montos
        // viejos dejarían un desglose fantasma en la orden.
        if (order.cashAmount != null) data.cashAmount = null;
        if (order.transferAmount != null) data.transferAmount = null;
      }

      const updated = await tx.order.update({
        where: { id: orderId },
        data,
        ...orderItemsInclude,
      });

      // La revisión es el destrabe más común: si con esto la orden quedó
      // completa, entra sola a preparación en la misma transacción.
      return applyAutoAdvance(tx, updated, { actorId: reviewedById });
    });

    if (advancedTo) await notifyAutoAdvance(orderId, advancedTo);

    return reviewed;
  },

  /**
   * Acción admin: confirma la seña (el dueño verificó la transferencia a ojo).
   * Registra la seña en el libro de cobros y sella quién/cuándo; `paymentStatus`
   * queda en DEPOSIT_PAID como consecuencia de esa fila, no por escritura directa.
   * No mueve `status` por sí misma, pero puede destrabar el avance automático.
   * Es independiente de `reviewOrder` (la seña suele confirmarse días después).
   * Solo opera si la orden requiere seña y el pago sigue en PENDING, así no pisa
   * un APPROVED/PAID_IN_FULL escrito por el webhook de MercadoPago.
   *
   * @param {string} [p.channel] `CASH`|`TRANSFER` — obligatorio si la orden es
   *   MIXED o todavía no tiene método de pago definido (ver `resolvePaymentChannel`).
   */
  async confirmDeposit({ tenantId, orderId, confirmedById, channel }) {
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

    const monto = roundMoney(Number(order.depositAmount ?? 0));

    // Una orden que exige seña sin monto pactado es un estado incoherente: antes
    // pasaba desapercibido (se sellaba un DEPOSIT_PAID sin plata detrás), ahora
    // no hay forma de anotarlo en el libro y se avisa.
    if (monto <= 0) {
      throw createError(
        "La orden requiere seña pero no tiene monto de seña pactado",
        "DEPOSIT_AMOUNT_MISSING",
        409
      );
    }

    return applyPayments({
      tenantId,
      order,
      actorId: confirmedById,
      entries: [
        {
          kind: "DEPOSIT",
          channel: resolvePaymentChannel(order, channel),
          amount: monto,
        },
      ],
      extraData: {
        depositConfirmedById: confirmedById,
        depositConfirmedAt: new Date(),
      },
    });
  },

  /**
   * Acción admin: confirma que la transferencia del pago llegó (la revisa un
   * asistente a mano, no hay verificación automática — el software no
   * gestiona el dinero). Solo aplica al método de pago TRANSFER/MIXED de esta
   * orden. Como las otras dos confirmaciones, puede destrabar el avance automático.
   *
   * Registra en el libro **lo que falta por transferencia**, no el total: sobre una
   * orden con seña ya cobrada anota solo el remanente. Si lo que entró fue otra
   * cosa —el cliente transfirió una parte— se manda `amount` y manda ese número:
   * quien confirma está mirando el extracto bancario, el software no.
   *
   * Acepta los `receiptIds` del comprobante que se está mirando (ver
   * [[Comprobantes]] en services/order-receipts.js): quedan enlazados a la fila
   * del libro que genera esta confirmación. Subir el comprobante NO confirma —eso
   * lo sigue haciendo una persona—, pero confirmar sí puede registrar qué miró.
   *
   * @param {number} [p.amount] monto realmente recibido; por defecto, lo que falte
   *   por transferencia
   * @param {number[]} [p.receiptIds] comprobantes que respaldan esta confirmación
   */
  async confirmTransfer({ tenantId, orderId, confirmedById, amount, receiptIds = [] }) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: { payments: true },
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

    const monto = roundMoney(
      Number(amount ?? pendingByChannel(order).TRANSFER)
    );

    return applyPayments({
      tenantId,
      order,
      actorId: confirmedById,
      // Monto 0 = la transferencia ya estaba cubierta (típico: la seña era por
      // transferencia y cubría todo). Se sella igual, pero no se cobra dos veces.
      entries:
        monto > 0
          ? [{ kind: "PAYMENT", channel: "TRANSFER", amount: monto }]
          : [],
      extraData: {
        transferConfirmedById: confirmedById,
        transferConfirmedAt: new Date(),
      },
      linkReceiptIds: receiptIds,
    });
  },

  /**
   * Acción admin: da por cobrado el total de la orden. Registra en el libro **lo
   * que falte** para llegar al total, por vía, y sella quién/cuándo; `PAID_IN_FULL`
   * sale de esas filas. No mueve `status` por sí misma; los dos ejes siguen siendo
   * independientes, con la única conexión del avance automático cuando el cobro
   * era lo último que faltaba.
   *
   * Es la contraparte manual del webhook de [[MercadoPago]] para los tenants que
   * cobran en efectivo o por transferencia: sin esto `PAID_IN_FULL` no lo escribía
   * ningún flujo y el estado de pago se quedaba en PENDING para siempre, incluso
   * en órdenes ya entregadas.
   *
   * **Cobrar el remanente, no el total, es lo que evita cobrar dos veces**: sobre
   * una orden con seña confirmada anota el saldo; sobre una MIXED con la
   * transferencia ya registrada, solo la parte en efectivo.
   *
   * Solo desde `PENDING` o `DEPOSIT_PAID` (una orden con seña se termina de cobrar
   * por acá), así no pisa un APPROVED/REJECTED/REFUNDED escrito por MercadoPago.
   * Igual que `confirmDeposit`/`confirmTransfer`: el software no verifica que la
   * plata haya entrado, solo registra que un humano la dio por cobrada.
   *
   * @param {string} [p.channel] obligatorio solo si la orden no tiene método de
   *   pago definido — sin eso no hay forma de saber por qué vía entró.
   */
  async confirmPayment({ tenantId, orderId, confirmedById, channel }) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: { payments: true },
    });

    if (!order) {
      throw createError("Orden no encontrada", "ORDER_NOT_FOUND", 404);
    }

    if (order.status === "CANCELLED") {
      throw createError(
        "No se puede cobrar una orden cancelada",
        "ORDER_ALREADY_CANCELLED",
        409
      );
    }

    if (!["PENDING", "DEPOSIT_PAID"].includes(order.paymentStatus)) {
      throw createError(
        "El estado de pago no permite confirmar el cobro total",
        "PAYMENT_NOT_CONFIRMABLE",
        409
      );
    }

    return applyPayments({
      tenantId,
      order,
      actorId: confirmedById,
      entries: buildSettlementEntries(order, channel),
      extraData: {
        paymentConfirmedById: confirmedById,
        paymentConfirmedAt: new Date(),
      },
    });
  },

  /**
   * Registro directo de un cobro (o de una devolución) en el libro:
   * `POST /orders/:id/payments`. Es la vía general —los tres `confirm-*` son
   * atajos sobre esto— y la que sirve para lo que no encaja en ellos: un pago
   * parcial a cuenta, una devolución, un cobro por una vía distinta a la pactada.
   *
   * @param {string} p.kind    `DEPOSIT` | `PAYMENT` | `REFUND`
   * @param {string} p.channel `CASH` | `TRANSFER` | `GATEWAY`
   * @param {number} p.amount  siempre positivo; el signo lo da `kind`
   */
  async registerPayment({ tenantId, orderId, kind, channel, amount, note, actorId }) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: { payments: true },
    });

    if (!order) {
      throw createError("Orden no encontrada", "ORDER_NOT_FOUND", 404);
    }

    // Sobre una orden cancelada solo tiene sentido devolver plata; cobrar, no.
    if (order.status === "CANCELLED" && kind !== "REFUND") {
      throw createError(
        "No se puede cobrar una orden cancelada",
        "ORDER_ALREADY_CANCELLED",
        409
      );
    }

    // Devolver más de lo que entró es un error de carga, no un caso de negocio:
    // dejaba el libro con `paid` negativo y todos los derivados (paymentStatus,
    // pendiente por vía, y mañana el arqueo de Caja) mintiendo en silencio.
    if (kind === "REFUND") {
      const { paid } = paymentSummary(order);
      const solicitado = roundMoney(Number(amount));

      if (solicitado > paid + MONEY_EPS) {
        const error = createError(
          "No se puede devolver más de lo que se cobró",
          "REFUND_EXCEEDS_PAID",
          409
        );
        error.details = { cobrado: paid, solicitado };
        throw error;
      }
    }

    return applyPayments({
      tenantId,
      order,
      actorId,
      entries: [{ kind, channel, amount, note }],
    });
  },

  /** Libro de cobros de una orden, con el resumen de cuánto entró y cuánto falta. */
  async getPayments({ tenantId, orderId }) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: { payments: { orderBy: { confirmedAt: "asc" } } },
    });

    if (!order) {
      throw createError("Orden no encontrada", "ORDER_NOT_FOUND", 404);
    }

    return {
      payments: order.payments,
      summary: paymentSummary(order),
      pending: pendingByChannel(order),
    };
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
          status: "NEW",
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
          toStatus: "NEW",
          note: "Pedido creado por el bot",
          changedById: null,
        },
      });

      return tx.order.findFirst({ where: { id: order.id }, ...orderItemsInclude });
    });
  },
};
