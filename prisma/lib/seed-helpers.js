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

export const PAYMENT_BY_STATUS = {
  COMPLETED: "APPROVED",
  PROCESSING: "IN_PROCESS",
  PENDING: "PENDING",
  CANCELLED: "REJECTED",
};

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
  PENDING: ["PENDING"],
  PROCESSING: ["PENDING", "PROCESSING"],
  COMPLETED: ["PENDING", "PROCESSING", "COMPLETED"],
  CANCELLED: ["PENDING", "CANCELLED"],
};

export const STATUS_NOTE = {
  PENDING: "Pedido creado",
  PROCESSING: "Pedido en preparación",
  COMPLETED: "Pedido completado",
  CANCELLED: "Pedido cancelado",
};

export function buildStatusHistory({ status, userId, createdAt }) {
  const flow = STATUS_FLOW[status] ?? ["PENDING"];
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

// depositPercentage/reviewerId solo se usan si algún spec trae requiresDeposit
// (mesa-dulce); tenants sin seña no los tocan y se comportan igual que antes.
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

    const data = {
      tenantId,
      userId,
      status: spec.status,
      total,
      paymentStatus: PAYMENT_BY_STATUS[spec.status],
      // OrderPaymentMethod es un enum (CASH/TRANSFER/MIXED) desde la migración
      // de fulfillment/payment method — las órdenes de seed asumen efectivo.
      paymentMethod: "CASH",
      paymentId: `seed-order-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt,
      updatedAt: createdAt,
      orderItems: { create: items },
      statusHistory: {
        create: buildStatusHistory({ status: spec.status, userId, createdAt }),
      },
    };

    if (spec.requiresDeposit) {
      data.requiresDeposit = true;
      data.depositAmount = Math.round(total * depositPercentage) / 100;

      if (spec.depositPaid) {
        // Seña confirmada antes de la primera transición de status (que
        // buildStatusHistory ubica a createdAt + 1h).
        data.depositConfirmedById = reviewerId;
        data.depositConfirmedAt = new Date(createdAt.getTime() + 30 * 60 * 1000);
        data.paymentStatus = spec.status === "COMPLETED" ? "PAID_IN_FULL" : "DEPOSIT_PAID";
      }
    }

    await prisma.order.create({ data });

    created += 1;
  }

  return created;
}
