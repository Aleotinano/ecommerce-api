import { describe, it, expect, beforeAll, afterAll } from "vitest";

const prisma = (await import("../lib/prisma.js")).default;
await import("../app.js");
const { OrderModel } = await import("../services/orders.js");
const { CartModel } = await import("../services/cart.js");
const { CashRegisterModel } = await import("../services/cash-register.js");
const { seedTenants, seedTenantConfig } = await import("./helpers.js");

// Fase 2: el enganche entre el libro de cobros de una orden y el turno de caja.
// Un movimiento por fila del libro que no sea GATEWAY, y nada más.

let acme;
let variant;
let adminId;
let customerId;

const movementsOf = (orderId) =>
  prisma.cashMovement.findMany({ where: { orderId }, orderBy: { id: "asc" } });

const openMovements = () =>
  prisma.cashMovement.findMany({ where: { tenantId: acme.id }, orderBy: { id: "asc" } });

async function setFlag(cashRegisterEnabled) {
  await prisma.tenantConfig.update({
    where: { tenantId: acme.id },
    data: { cashRegisterEnabled },
  });
}

async function resetCaja() {
  await prisma.cashMovement.deleteMany({ where: { tenantId: acme.id } });
  await prisma.cashRegisterSession.deleteMany({ where: { tenantId: acme.id } });
}

async function abrirCaja(openingAmount = 0) {
  await resetCaja();
  return CashRegisterModel.open({
    tenantId: acme.id,
    openingAmount,
    openedById: adminId,
  });
}

/** Orden real desde el carrito, con el método de pago que se le pase. */
async function checkout(fulfillment) {
  await CartModel.add({
    tenantId: acme.id,
    userId: customerId,
    productId: variant.productId,
    variantId: variant.id,
  });

  return OrderModel.create({
    tenantId: acme.id,
    userId: customerId,
    fulfillmentMethod: "PICKUP",
    ...fulfillment,
  });
}

beforeAll(async () => {
  ({ acme } = await seedTenants());
  await seedTenantConfig(acme.id, { cashRegisterEnabled: true });
  await CashRegisterModel.ensureDefaultCategories({ tenantId: acme.id });

  variant = await prisma.productVariant.findFirst({ where: { tenantId: acme.id } });
  adminId = acme.users.find((u) => u.role === "ADMIN").id;
  customerId = acme.users.find((u) => u.role === "CUSTOMER").id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("con la caja apagada (todos los tenants hoy)", () => {
  beforeAll(async () => {
    await resetCaja();
    await setFlag(false);
  });

  afterAll(async () => {
    await setFlag(true);
  });

  it("el cobro funciona igual y NO se crea ningún movimiento", async () => {
    const order = await checkout({ paymentMethod: "CASH" });

    const cobrada = await OrderModel.confirmPayment({
      tenantId: acme.id,
      orderId: order.id,
      confirmedById: adminId,
    });

    expect(cobrada.paymentStatus).toBe("PAID_IN_FULL");
    expect(await movementsOf(order.id)).toHaveLength(0);
  });

  it("completar una orden tampoco exige caja abierta", async () => {
    const order = await checkout({ paymentMethod: "CASH" });

    const completada = await OrderModel.updateOrderStatus({
      tenantId: acme.id,
      orderId: order.id,
      status: "COMPLETED",
      changedById: adminId,
    });

    expect(completada.status).toBe("COMPLETED");
    expect(await movementsOf(order.id)).toHaveLength(0);
  });
});

describe("guard de caja abierta", () => {
  beforeAll(async () => {
    await resetCaja();
  });

  it("sin turno abierto, confirmar el cobro → 409 y la orden queda SIN cobrar", async () => {
    const order = await checkout({ paymentMethod: "CASH" });

    await expect(
      OrderModel.confirmPayment({
        tenantId: acme.id,
        orderId: order.id,
        confirmedById: adminId,
      })
    ).rejects.toMatchObject({ code: "CASH_SESSION_NOT_OPEN", statusCode: 409 });

    // Lo que importa del guard: el rollback. Si el sello quedara escrito, la orden
    // figuraría cobrada y esa plata no estaría en ningún arqueo.
    const despues = await prisma.order.findUnique({
      where: { id: order.id },
      include: { payments: true },
    });

    expect(despues.paymentStatus).toBe("PENDING");
    expect(despues.paymentConfirmedAt).toBeNull();
    expect(despues.payments).toHaveLength(0);
  });

  it("sin turno abierto, completar una orden en efectivo → 409 y el estado no se mueve", async () => {
    const order = await checkout({ paymentMethod: "CASH" });

    await expect(
      OrderModel.updateOrderStatus({
        tenantId: acme.id,
        orderId: order.id,
        status: "COMPLETED",
        changedById: adminId,
      })
    ).rejects.toMatchObject({ code: "CASH_SESSION_NOT_OPEN" });

    const despues = await prisma.order.findUnique({ where: { id: order.id } });
    expect(despues.status).toBe("PENDING");
  });

  it("completar una orden YA cobrada no exige turno: no hay nada que anotar", async () => {
    // La liquidación sale vacía, así que el guard no corre. Es la diferencia entre
    // "no hay plata nueva" y "hay plata que no sé dónde poner".
    await abrirCaja(0);
    const order = await checkout({ paymentMethod: "TRANSFER" });

    await OrderModel.confirmTransfer({
      tenantId: acme.id,
      orderId: order.id,
      confirmedById: adminId,
    });

    await resetCaja();

    const completada = await OrderModel.updateOrderStatus({
      tenantId: acme.id,
      orderId: order.id,
      status: "COMPLETED",
      changedById: adminId,
    });

    expect(completada.status).toBe("COMPLETED");
  });
});

describe("un movimiento por fila del libro", () => {
  it("confirmar el cobro en efectivo anota un ORDER_PAYMENT en el turno", async () => {
    const session = await abrirCaja(1000);
    const order = await checkout({ paymentMethod: "CASH" });

    await OrderModel.confirmPayment({
      tenantId: acme.id,
      orderId: order.id,
      confirmedById: adminId,
    });

    const [movimiento] = await movementsOf(order.id);

    expect(movimiento).toMatchObject({
      sessionId: session.id,
      type: "ORDER_PAYMENT",
      channel: "CASH",
      amount: order.total,
      categoryId: null,
      createdById: adminId,
    });
    expect(movimiento.orderPaymentId).not.toBeNull();
    expect(movimiento.note).toBe(`Orden #${order.id}`);

    const current = await CashRegisterModel.getCurrent({ tenantId: acme.id });
    expect(current.totals.expectedCashAmount).toBe(1000 + order.total);
  });

  it("completar una orden en efectivo sin confirmar antes: el cobro entra por ese camino", async () => {
    await abrirCaja(0);
    const order = await checkout({ paymentMethod: "CASH" });

    await OrderModel.updateOrderStatus({
      tenantId: acme.id,
      orderId: order.id,
      status: "COMPLETED",
      changedById: adminId,
    });

    const movimientos = await movementsOf(order.id);
    expect(movimientos).toHaveLength(1);
    expect(movimientos[0]).toMatchObject({ type: "ORDER_PAYMENT", channel: "CASH" });

    const current = await CashRegisterModel.getCurrent({ tenantId: acme.id });
    expect(current.totals.expectedCashAmount).toBe(order.total);
  });

  it("la seña anota ORDER_DEPOSIT y el saldo, un ORDER_PAYMENT aparte", async () => {
    await abrirCaja(0);
    await seedTenantConfig(acme.id, {
      cashRegisterEnabled: true,
      depositEnabled: true,
      depositPercentage: 50,
    });

    const order = await checkout({ paymentMethod: "CASH" });
    expect(order.requiresDeposit).toBe(true);

    await OrderModel.confirmDeposit({
      tenantId: acme.id,
      orderId: order.id,
      confirmedById: adminId,
    });

    await OrderModel.confirmPayment({
      tenantId: acme.id,
      orderId: order.id,
      confirmedById: adminId,
    });

    const movimientos = await movementsOf(order.id);

    expect(movimientos.map((m) => m.type)).toEqual(["ORDER_DEPOSIT", "ORDER_PAYMENT"]);
    // Sin duplicar: la seña + el saldo suman el total, no una vez y media.
    expect(movimientos.reduce((acc, m) => acc + m.amount, 0)).toBe(order.total);

    await seedTenantConfig(acme.id, {
      cashRegisterEnabled: true,
      depositEnabled: false,
    });
  });

  it("orden MIXED: dos movimientos, uno por vía, sin duplicar la parte transferida", async () => {
    await abrirCaja(0);
    const order = await checkout({
      paymentMethod: "MIXED",
      cashAmount: 2000,
      transferAmount: 2500,
    });

    await OrderModel.confirmTransfer({
      tenantId: acme.id,
      orderId: order.id,
      confirmedById: adminId,
    });

    await OrderModel.confirmPayment({
      tenantId: acme.id,
      orderId: order.id,
      confirmedById: adminId,
    });

    const movimientos = await movementsOf(order.id);

    expect(movimientos).toHaveLength(2);
    expect(movimientos.map((m) => [m.channel, m.amount])).toEqual([
      ["TRANSFER", 2500],
      ["CASH", 2000],
    ]);

    // El arqueo solo cuenta el efectivo; la transferencia va informada aparte.
    const current = await CashRegisterModel.getCurrent({ tenantId: acme.id });
    expect(current.totals.expectedCashAmount).toBe(2000);
    expect(current.totals.transferTotal).toBe(2500);
  });

  it("una devolución en efectivo resta del arqueo", async () => {
    await abrirCaja(0);
    const order = await checkout({ paymentMethod: "CASH" });

    await OrderModel.confirmPayment({
      tenantId: acme.id,
      orderId: order.id,
      confirmedById: adminId,
    });

    await OrderModel.registerPayment({
      tenantId: acme.id,
      orderId: order.id,
      kind: "REFUND",
      channel: "CASH",
      amount: 1000,
      actorId: adminId,
    });

    const movimientos = await movementsOf(order.id);
    expect(movimientos.map((m) => m.type)).toEqual(["ORDER_PAYMENT", "ORDER_REFUND"]);

    const current = await CashRegisterModel.getCurrent({ tenantId: acme.id });
    expect(current.totals.expectedCashAmount).toBe(order.total - 1000);
  });

  it("MercadoPago (GATEWAY) no toca la caja", async () => {
    await abrirCaja(0);
    const order = await checkout({ paymentMethod: "TRANSFER" });

    await OrderModel.registerPayment({
      tenantId: acme.id,
      orderId: order.id,
      kind: "PAYMENT",
      channel: "GATEWAY",
      amount: order.total,
      note: "MercadoPago 123",
    });

    expect(await movementsOf(order.id)).toHaveLength(0);

    const current = await CashRegisterModel.getCurrent({ tenantId: acme.id });
    expect(current.totals.expectedCashAmount).toBe(0);
  });

  it("los movimientos de órdenes se leen por tipo, no por etiqueta", async () => {
    await abrirCaja(0);
    const order = await checkout({ paymentMethod: "CASH" });

    await OrderModel.confirmPayment({
      tenantId: acme.id,
      orderId: order.id,
      confirmedById: adminId,
    });

    const insumos = await prisma.cashCategory.findFirst({
      where: { tenantId: acme.id, key: "insumos" },
    });

    await CashRegisterModel.addMovement({
      tenantId: acme.id,
      type: "EXPENSE",
      channel: "CASH",
      amount: 500,
      categoryId: insumos.id,
      createdById: adminId,
    });

    const resumen = await CashRegisterModel.getSummary({ tenantId: acme.id });

    expect(resumen.byType.ORDER_PAYMENT).toBe(order.total);
    expect(resumen.byCategory.insumos.total).toBe(-500);
    // La venta no entra en ninguna etiqueta: no tiene por qué.
    expect(Object.keys(resumen.byCategory)).toEqual(["insumos"]);
  });
});

describe("idempotencia del enganche", () => {
  it("un cobro ya anotado no se duplica en el arqueo", async () => {
    await abrirCaja(0);
    const order = await checkout({ paymentMethod: "CASH" });

    const cobrada = await OrderModel.confirmPayment({
      tenantId: acme.id,
      orderId: order.id,
      confirmedById: adminId,
    });

    const [fila] = cobrada.payments;

    // Se reintenta el mismo cobro a mano, como si un retry hubiera pasado dos
    // veces por el mismo camino: el UNIQUE de `orderPaymentId` lo absorbe.
    const { recordOrderPayments } = await import("../services/cash-register.js");
    await prisma.$transaction((tx) =>
      recordOrderPayments(tx, {
        tenantId: acme.id,
        orderId: order.id,
        payments: [fila],
        actorId: adminId,
      })
    );

    expect(await movementsOf(order.id)).toHaveLength(1);
  });

  it("confirmar dos veces no agrega un segundo movimiento", async () => {
    await abrirCaja(0);
    const order = await checkout({ paymentMethod: "CASH" });

    await OrderModel.confirmPayment({
      tenantId: acme.id,
      orderId: order.id,
      confirmedById: adminId,
    });

    // El segundo intento choca con el guard de estado de la orden, antes de la caja.
    await expect(
      OrderModel.confirmPayment({
        tenantId: acme.id,
        orderId: order.id,
        confirmedById: adminId,
      })
    ).rejects.toMatchObject({ code: "PAYMENT_NOT_CONFIRMABLE" });

    expect(await movementsOf(order.id)).toHaveLength(1);
    expect(await openMovements()).toHaveLength(1);
  });
});
