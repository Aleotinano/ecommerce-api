import { describe, it, expect, beforeAll, afterAll } from "vitest";

const prisma = (await import("../lib/prisma.js")).default;
const { evaluateOrder, derivePaymentStatus } = await import(
  "../services/order-state.js"
);
const { seedOrdersForUser } = await import("../prisma/lib/seed-helpers.js");
const { seedTenants } = await import("./helpers.js");

// Las órdenes de demo tienen que ser POSIBLES: si una orden sembrada en
// PROCESSING tiene blockers, es una orden que el sistema real nunca habría dejado
// llegar ahí, y probar el panel contra eso confunde más de lo que ayuda.

let acme;
let customerId;

const SKU = "ACM-REM-NM";

beforeAll(async () => {
  ({ acme } = await seedTenants());
  customerId = acme.users.find((u) => u.role === "CUSTOMER").id;

  await seedOrdersForUser({
    tenantId: acme.id,
    userId: customerId,
    reviewerId: acme.users.find((u) => u.role === "ADMIN").id,
    orders: [
      { status: "NEW", daysAgo: 1, paymentMethod: "CASH", items: [{ sku: SKU, quantity: 1 }] },
      {
        status: "PROCESSING",
        daysAgo: 3,
        paymentMethod: "TRANSFER",
        fulfillmentMethod: "DELIVERY",
        addressText: "Av. Siempre Viva 742",
        items: [{ sku: SKU, quantity: 2 }],
      },
      {
        status: "READY",
        daysAgo: 2,
        paymentMethod: "MIXED",
        transferShare: 0.5,
        items: [{ sku: SKU, quantity: 3 }],
      },
      { status: "COMPLETED", daysAgo: 10, paymentMethod: "CASH", items: [{ sku: SKU, quantity: 1 }] },
      {
        status: "COMPLETED",
        daysAgo: 20,
        paymentMethod: "MIXED",
        transferShare: 0.4,
        items: [{ sku: SKU, quantity: 2 }],
      },
      { status: "CANCELLED", daysAgo: 6, paymentMethod: "TRANSFER", items: [{ sku: SKU, quantity: 1 }] },
    ],
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

const seededOrders = () =>
  prisma.order.findMany({
    where: { tenantId: acme.id, userId: customerId },
    include: { payments: true },
    orderBy: { id: "asc" },
  });

describe("órdenes de demo", () => {
  it("ninguna queda trabada por datos faltantes", async () => {
    for (const order of await seededOrders()) {
      const { blockers } = evaluateOrder(order, order.payments);
      expect(
        blockers.map((b) => b.code),
        `orden ${order.id} (${order.status}, ${order.paymentMethod})`
      ).toEqual([]);
    }
  });

  it("el estado de pago coincide con lo que dice el libro", async () => {
    for (const order of await seededOrders()) {
      expect(derivePaymentStatus(order, order.payments)).toBe(order.paymentStatus);
    }
  });

  it("lo cobrado es coherente con el momento del pedido", async () => {
    const orders = await seededOrders();
    const paid = (order) =>
      order.payments.reduce((sum, p) => sum + p.amount, 0);

    for (const order of orders) {
      if (order.status === "COMPLETED") {
        // Entregada = cobrada, y con el desglose que corresponde al método.
        expect(paid(order), `orden ${order.id}`).toBe(order.total);
        expect(order.paymentConfirmedAt).not.toBeNull();
      }

      if (["NEW", "CANCELLED"].includes(order.status)) {
        expect(paid(order), `orden ${order.id}`).toBe(0);
      }

      // En producción con transferencia: esa parte ya entró, el efectivo no.
      if (order.status === "PROCESSING" && order.paymentMethod === "TRANSFER") {
        expect(paid(order)).toBe(order.total);
      }
      if (order.status === "READY" && order.paymentMethod === "MIXED") {
        expect(paid(order)).toBe(order.transferAmount);
        expect(order.payments.every((p) => p.channel === "TRANSFER")).toBe(true);
      }
    }
  });

  it("el desglose del mixto suma el total exacto", async () => {
    const mixtas = (await seededOrders()).filter((o) => o.paymentMethod === "MIXED");
    expect(mixtas.length).toBeGreaterThan(0);

    for (const order of mixtas) {
      expect(order.cashAmount + order.transferAmount).toBe(order.total);
    }
  });
});
