import prisma from "../../lib/prisma.js";

// ---------------------------------------------------------------------------
// Helpers de seeding compartidos entre prisma/seed.js (seed monolítico de los
// 3 tenants) y los scripts por-tenant (ver prisma/mesa-dulce/*.js). Viven acá
// porque seed.js corre un main() con TRUNCATE al importarse — nada que quiera
// ejecutarse standalone puede importar seed.js directamente.
// ---------------------------------------------------------------------------

export const CLOUD_NAME = "dqukj1pac";

export function cld({ id, v, ext = "jpg" }) {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/q_auto/f_auto/v${v}/${id}.${ext}`;
}

// `PAYMENT_BY_STATUS` (mapa fijo estado → estado de pago) se eliminó: desde el
// libro de cobros, `paymentStatus` se deriva de lo efectivamente cobrado. Un mapa
// fijo generaba datos imposibles — una orden completada en efectivo quedaba como
// `APPROVED`, que ahora significa "lo cobró MercadoPago", y sin una sola fila de
// cobro detrás. Ver `buildPaymentPlan`.

export function daysAgo(n) {
  const date = new Date();
  date.setDate(date.getDate() - n);
  date.setHours(12, 30, 0, 0);
  return date;
}

export async function variantBySku(tenantId, sku) {
  return prisma.productVariant.findUnique({
    where: { tenantId_sku: { tenantId, sku } },
    include: { product: { select: { price: true } } },
  });
}

// Secuencia de estados por los que pasó la orden hasta su estado final, para
// poblar un timeline coherente de demo.
export const STATUS_FLOW = {
  NEW: ["NEW"],
  PROCESSING: ["NEW", "PROCESSING"],
  READY: ["NEW", "PROCESSING", "READY"],
  COMPLETED: ["NEW", "PROCESSING", "READY", "COMPLETED"],
  CANCELLED: ["NEW", "CANCELLED"],
};

export const STATUS_NOTE = {
  NEW: "Pedido creado",
  PROCESSING: "Pedido en preparación",
  READY: "Pedido listo para entregar",
  COMPLETED: "Pedido completado",
  CANCELLED: "Pedido cancelado",
};

export function buildStatusHistory({ status, userId, createdAt }) {
  const flow = STATUS_FLOW[status] ?? ["NEW"];
  return flow.map((toStatus, index) => {
    // Cada transición ocurre algo después de la creación de la orden.
    const at = new Date(createdAt.getTime() + index * 60 * 60 * 1000);
    return {
      fromStatus: index === 0 ? null : flow[index - 1],
      toStatus,
      note: STATUS_NOTE[toStatus],
      changedById: index === 0 ? userId : null,
      createdAt: at,
    };
  });
}

/**
 * Cómo se cobró la orden, coherente con el estado en el que quedó. No es una
 * tabla de datos lindos: reproduce la regla real del negocio, que es lo único que
 * hace que una demo sirva para probar algo.
 *
 * - Cancelada o recién entrada: no entró nada.
 * - En producción o lista: si el pago era por transferencia (total o la parte
 *   mixta), esa plata YA entró — es justamente lo que destrabó la producción. Lo
 *   que se paga en efectivo todavía no: se cobra al entregar.
 * - Completada: entró todo.
 *
 * Devuelve las filas del libro (`OrderPayment`), el `paymentStatus` que se deriva
 * de ellas y los sellos que el panel muestra.
 */
function buildPaymentPlan({
  status,
  paymentMethod,
  total,
  cashAmount,
  transferAmount,
  createdAt,
  actorId,
  deposit,
}) {
  const payments = [];
  const seals = {};

  const esperado = {
    CASH: paymentMethod === "MIXED" ? cashAmount : paymentMethod === "CASH" ? total : 0,
    TRANSFER:
      paymentMethod === "MIXED" ? transferAmount : paymentMethod === "TRANSFER" ? total : 0,
  };

  // Media hora después de entrar el pedido: antes de la primera transición, que
  // `buildStatusHistory` ubica a +1h.
  const alCobrar = new Date(createdAt.getTime() + 30 * 60 * 1000);
  const alEntregar = new Date(createdAt.getTime() + 4 * 60 * 60 * 1000);

  const produciendo = ["PROCESSING", "READY", "COMPLETED"].includes(status);
  const entregada = status === "COMPLETED";

  if (deposit?.paid) {
    payments.push({
      kind: "DEPOSIT",
      channel: paymentMethod === "CASH" ? "CASH" : "TRANSFER",
      amount: deposit.amount,
      note: "Seña confirmada",
      confirmedById: actorId,
      confirmedAt: alCobrar,
    });
  }

  const señaPorTransferencia = deposit?.paid && paymentMethod !== "CASH" ? deposit.amount : 0;
  const faltaTransferir = Math.max(esperado.TRANSFER - señaPorTransferencia, 0);

  if (produciendo && faltaTransferir > 0) {
    payments.push({
      kind: "PAYMENT",
      channel: "TRANSFER",
      amount: faltaTransferir,
      note: "Transferencia verificada",
      confirmedById: actorId,
      confirmedAt: alCobrar,
    });
    seals.transferConfirmedById = actorId;
    seals.transferConfirmedAt = alCobrar;
  }

  const cobrado = payments.reduce((sum, p) => sum + p.amount, 0);

  if (entregada && total - cobrado > 0) {
    payments.push({
      kind: "PAYMENT",
      channel: "CASH",
      amount: total - cobrado,
      note: "Cobrado al entregar",
      confirmedById: actorId,
      confirmedAt: alEntregar,
    });
  }

  const neto = payments.reduce((sum, p) => sum + p.amount, 0);

  if (neto >= total && total > 0) {
    seals.paymentConfirmedById = actorId;
    seals.paymentConfirmedAt = alEntregar;
  }

  // La misma derivación que hace `derivePaymentStatus` en runtime.
  const paymentStatus =
    neto >= total && total > 0 ? "PAID_IN_FULL" : neto > 0 ? "DEPOSIT_PAID" : "PENDING";

  return { payments, paymentStatus, seals };
}

/**
 * Órdenes de demo para un usuario.
 *
 * Cada spec acepta, además de `status`/`daysAgo`/`items`:
 * - `fulfillmentMethod` (`PICKUP` por defecto) + `addressText`/`addressDetails`
 * - `paymentMethod` (`CASH` por defecto) y, para `MIXED`, `transferShare` (0-1)
 * - `requiresDeposit`/`depositPaid` (solo tenants con seña)
 *
 * Los datos de entrega y pago **no son decorativos**: sin ellos las órdenes de
 * demo quedan trabadas por `FULFILLMENT_INCOMPLETE` en un estado al que nunca
 * podrían haber llegado (ver services/order-state.js).
 */
export async function seedOrdersForUser({ tenantId, userId, orders, depositPercentage, reviewerId }) {
  let created = 0;

  for (const spec of orders) {
    const items = [];

    for (const line of spec.items) {
      const variant = await variantBySku(tenantId, line.sku);
      if (!variant) continue;
      // Precio efectivo: variante o, si es null, el del producto.
      const price = variant.price ?? variant.product.price ?? 0;
      items.push({
        productId: variant.productId,
        variantId: variant.id,
        quantity: line.quantity,
        price,
      });
    }

    if (!items.length) continue;

    const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const createdAt = daysAgo(spec.daysAgo);

    const paymentMethod = spec.paymentMethod ?? "CASH";
    const fulfillmentMethod = spec.fulfillmentMethod ?? "PICKUP";

    // El desglose del mixto tiene que sumar el total exacto, igual que lo exige
    // el checkout: se redondea la parte transferida y el resto va a efectivo.
    const transferAmount =
      paymentMethod === "MIXED"
        ? Math.round(total * (spec.transferShare ?? 0.5) * 100) / 100
        : null;
    const cashAmount = paymentMethod === "MIXED" ? Math.round((total - transferAmount) * 100) / 100 : null;

    const deposit = spec.requiresDeposit
      ? {
          amount: Math.round(total * depositPercentage) / 100,
          paid: Boolean(spec.depositPaid),
        }
      : null;

    const { payments, paymentStatus, seals } = buildPaymentPlan({
      status: spec.status,
      paymentMethod,
      total,
      cashAmount,
      transferAmount,
      createdAt,
      actorId: reviewerId ?? null,
      deposit,
    });

    const data = {
      tenantId,
      userId,
      status: spec.status,
      total,
      paymentStatus,
      paymentMethod,
      cashAmount,
      transferAmount,
      fulfillmentMethod,
      addressText: fulfillmentMethod === "DELIVERY" ? spec.addressText ?? null : null,
      addressDetails: fulfillmentMethod === "DELIVERY" ? spec.addressDetails ?? null : null,
      paymentId: `seed-order-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt,
      updatedAt: createdAt,
      orderItems: { create: items },
      statusHistory: {
        create: buildStatusHistory({ status: spec.status, userId, createdAt }),
      },
      ...seals,
    };

    if (deposit) {
      data.requiresDeposit = true;
      data.depositAmount = deposit.amount;

      if (deposit.paid) {
        data.depositConfirmedById = reviewerId;
        data.depositConfirmedAt = new Date(createdAt.getTime() + 30 * 60 * 1000);
      }
    }

    if (payments.length) {
      data.payments = { create: payments.map((entry) => ({ tenantId, ...entry })) };
    }

    await prisma.order.create({ data });

    created += 1;
  }

  return created;
}
