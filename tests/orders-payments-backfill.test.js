import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile } from "node:fs/promises";

const prisma = (await import("../lib/prisma.js")).default;
const { derivePaymentStatus } = await import("../services/order-state.js");
const { seedTenants } = await import("./helpers.js");

// El backfill de `20260729180000_add_order_payments` corre UNA vez contra datos
// reales y reconstruye el libro a partir de los sellos. Este test ejecuta el SQL
// de la migración tal cual está en el archivo —no una copia— sobre órdenes armadas
// a mano con los sellos viejos y sin ninguna fila de cobro.

const MIGRATION =
  "prisma/migrations/20260729180000_add_order_payments/migration.sql";

let acme;
let variant;

/** Los INSERT del backfill, extraídos del SQL real de la migración. */
async function backfillStatements() {
  const raw = await readFile(MIGRATION, "utf8");
  const [, backfill] = raw.split("-- BACKFILL:");

  return backfill
    .split(";")
    .map((chunk) => {
      const sql = chunk
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");

      // Se corta desde el INSERT: lo que quede antes es la cola del comentario
      // que separaba los pasos.
      const start = sql.indexOf("INSERT INTO");
      return start === -1 ? "" : sql.slice(start).trim();
    })
    .filter(Boolean);
}

async function legacyOrder(data) {
  const order = await prisma.order.create({
    data: {
      tenantId: acme.id,
      total: 10000,
      status: "PENDING",
      origin: "ADMIN",
      ...data,
    },
  });

  await prisma.orderItem.create({
    data: {
      orderId: order.id,
      productId: variant.productId,
      variantId: variant.id,
      quantity: 1,
      price: 10000,
    },
  });

  return order;
}

const paymentsOf = (orderId) =>
  prisma.orderPayment.findMany({ where: { orderId }, orderBy: { id: "asc" } });

beforeAll(async () => {
  ({ acme } = await seedTenants());
  variant = await prisma.productVariant.findFirst({ where: { tenantId: acme.id } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("backfill del libro de cobros", () => {
  it("reconstruye una fila por sello, sin sumar de más", async () => {
    const ayer = new Date("2026-07-01T12:00:00Z");

    // 1. Seña + transferencia + cobro total sobre una orden por transferencia.
    const completa = await legacyOrder({
      paymentMethod: "TRANSFER",
      paymentStatus: "PAID_IN_FULL",
      requiresDeposit: true,
      depositAmount: 5000,
      depositConfirmedAt: ayer,
      transferConfirmedAt: ayer,
      paymentConfirmedAt: ayer,
    });

    // 2. Mixta con solo la transferencia confirmada.
    const mixta = await legacyOrder({
      paymentMethod: "MIXED",
      paymentStatus: "DEPOSIT_PAID",
      cashAmount: 4000,
      transferAmount: 6000,
      transferConfirmedAt: ayer,
    });

    // 3. Cobrada por MercadoPago, sin ninguna confirmación manual.
    const gateway = await legacyOrder({
      paymentMethod: "CASH",
      paymentStatus: "APPROVED",
    });

    // 4. Sin cobrar: no debería generar ninguna fila.
    const virgen = await legacyOrder({ paymentMethod: "CASH" });

    for (const statement of await backfillStatements()) {
      await prisma.$executeRawUnsafe(statement);
    }

    // La seña por transferencia + el remanente por la misma vía: 5000 + 5000, no
    // 5000 + 10000. Que cada paso descuente lo anterior es LO que se está probando.
    const filas = await paymentsOf(completa.id);
    expect(filas).toHaveLength(2);
    expect(filas[0]).toMatchObject({ kind: "DEPOSIT", channel: "TRANSFER", amount: 5000 });
    expect(filas[1]).toMatchObject({ kind: "PAYMENT", channel: "TRANSFER", amount: 5000 });
    expect(filas.reduce((sum, f) => sum + f.amount, 0)).toBe(10000);

    const mixtas = await paymentsOf(mixta.id);
    expect(mixtas).toHaveLength(1);
    expect(mixtas[0]).toMatchObject({ channel: "TRANSFER", amount: 6000 });

    const gateways = await paymentsOf(gateway.id);
    expect(gateways).toHaveLength(1);
    expect(gateways[0]).toMatchObject({ channel: "GATEWAY", amount: 10000 });

    expect(await paymentsOf(virgen.id)).toHaveLength(0);

    // Y el invariante que hace que el deploy sea seguro: el estado de pago que
    // deriva del libro reconstruido es el que la orden ya tenía.
    for (const orden of [completa, mixta, gateway, virgen]) {
      const conLibro = await prisma.order.findUnique({
        where: { id: orden.id },
        include: { payments: true },
      });
      expect(derivePaymentStatus(conLibro, conLibro.payments)).toBe(orden.paymentStatus);
    }
  });
});
