import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

const prisma = (await import("../lib/prisma.js")).default;
const { app } = await import("../app.js");
const { OrderModel } = await import("../services/orders.js");
const { CartModel } = await import("../services/cart.js");
const { seedTenants, seedTenantConfig, loginAs } = await import("./helpers.js");

// El libro de cobros: una fila por cobro, con vía y monto. `paymentStatus` deja de
// escribirse a mano y pasa a derivarse de estas filas.

let acme;
let acmeVariant;
let acmeAdminId;
let acmeCustomerId;
let cookie;

const paymentsOf = (orderId) =>
  prisma.orderPayment.findMany({ where: { orderId }, orderBy: { id: "asc" } });

beforeAll(async () => {
  ({ acme } = await seedTenants());
  await seedTenantConfig(acme.id);

  acmeVariant = await prisma.productVariant.findFirst({ where: { tenantId: acme.id } });
  acmeAdminId = acme.users.find((u) => u.role === "ADMIN").id;
  acmeCustomerId = acme.users.find((u) => u.role === "CUSTOMER").id;

  ({ cookie } = await loginAs(app, { email: "admin@acme.com" }));
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** Orden del bot: nace sin método de pago, que es el caso ambiguo. */
function draft(quantity = 1) {
  return OrderModel.createDraft({
    tenantId: acme.id,
    items: [{ productId: acmeVariant.productId, variantId: acmeVariant.id, quantity }],
  });
}

/** Orden real desde el carrito, con el método de pago que se le pase. */
async function checkout(fulfillment) {
  await CartModel.add({
    tenantId: acme.id,
    userId: acmeCustomerId,
    productId: acmeVariant.productId,
    variantId: acmeVariant.id,
  });

  return OrderModel.create({
    tenantId: acme.id,
    userId: acmeCustomerId,
    fulfillmentMethod: "PICKUP",
    ...fulfillment,
  });
}

describe("POST /orders/:id/payments", () => {
  it("registra el cobro y deriva el estado de pago", async () => {
    const order = await draft();

    const res = await request(app)
      .post(`/orders/${order.id}/payments`)
      .set("Cookie", cookie)
      .send({ kind: "PAYMENT", channel: "CASH", amount: order.total, note: "En el local" });

    expect(res.status).toBe(201);
    expect(res.body.order.paymentStatus).toBe("PAID_IN_FULL");
    expect(res.body.order.payment).toMatchObject({
      total: order.total,
      paid: order.total,
      pending: 0,
      settled: true,
    });

    const [fila] = await paymentsOf(order.id);
    expect(fila).toMatchObject({
      kind: "PAYMENT",
      channel: "CASH",
      amount: order.total,
      note: "En el local",
      confirmedById: acmeAdminId,
    });
  });

  it("un cobro parcial deja el estado en DEPOSIT_PAID y el resto pendiente", async () => {
    const order = await draft();

    const res = await request(app)
      .post(`/orders/${order.id}/payments`)
      .set("Cookie", cookie)
      .send({ kind: "PAYMENT", channel: "CASH", amount: 1000 });

    expect(res.status).toBe(201);
    expect(res.body.order.paymentStatus).toBe("DEPOSIT_PAID");
    expect(res.body.order.payment.pending).toBe(order.total - 1000);
  });

  it("una devolución resta del neto y el estado vuelve atrás", async () => {
    const order = await draft();

    await request(app)
      .post(`/orders/${order.id}/payments`)
      .set("Cookie", cookie)
      .send({ kind: "PAYMENT", channel: "CASH", amount: order.total });

    const res = await request(app)
      .post(`/orders/${order.id}/payments`)
      .set("Cookie", cookie)
      .send({ kind: "REFUND", channel: "CASH", amount: 500, note: "Faltaba un item" });

    expect(res.status).toBe(201);
    expect(res.body.order.paymentStatus).toBe("DEPOSIT_PAID");
    expect(res.body.order.payment.paid).toBe(order.total - 500);
  });

  it("rechaza montos no positivos y la vía de MercadoPago", async () => {
    const order = await draft();

    const negativo = await request(app)
      .post(`/orders/${order.id}/payments`)
      .set("Cookie", cookie)
      .send({ kind: "PAYMENT", channel: "CASH", amount: -100 });
    expect(negativo.status).toBe(400);

    // GATEWAY existe en el enum, pero esas filas las escribe el webhook: nadie
    // declara a mano que MercadoPago cobró.
    const gateway = await request(app)
      .post(`/orders/${order.id}/payments`)
      .set("Cookie", cookie)
      .send({ kind: "PAYMENT", channel: "GATEWAY", amount: 100 });
    expect(gateway.status).toBe(400);
  });

  it("no se puede cobrar una orden cancelada, pero sí devolverle plata", async () => {
    const order = await draft();

    // La plata tiene que haber entrado ANTES de cancelar: sobre una orden
    // cancelada ya no se puede cobrar, solo devolver.
    await request(app)
      .post(`/orders/${order.id}/payments`)
      .set("Cookie", cookie)
      .send({ kind: "PAYMENT", channel: "CASH", amount: 100 });

    await OrderModel.updateOrderStatus({
      tenantId: acme.id,
      orderId: order.id,
      status: "CANCELLED",
    });

    const cobro = await request(app)
      .post(`/orders/${order.id}/payments`)
      .set("Cookie", cookie)
      .send({ kind: "PAYMENT", channel: "CASH", amount: 100 });
    expect(cobro.status).toBe(409);
    expect(cobro.body.error.code).toBe("ORDER_ALREADY_CANCELLED");

    const devolucion = await request(app)
      .post(`/orders/${order.id}/payments`)
      .set("Cookie", cookie)
      .send({ kind: "REFUND", channel: "CASH", amount: 100 });
    expect(devolucion.status).toBe(201);
    expect(devolucion.body.order.paymentStatus).toBe("REFUNDED");
  });

  it("no se puede devolver más de lo que entró", async () => {
    const order = await draft();

    await request(app)
      .post(`/orders/${order.id}/payments`)
      .set("Cookie", cookie)
      .send({ kind: "PAYMENT", channel: "CASH", amount: 1000 });

    const res = await request(app)
      .post(`/orders/${order.id}/payments`)
      .set("Cookie", cookie)
      .send({ kind: "REFUND", channel: "CASH", amount: 1500 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("REFUND_EXCEEDS_PAID");
    expect(res.body.error.details).toEqual({ cobrado: 1000, solicitado: 1500 });
  });
});

describe("GET /orders/:id/payments", () => {
  it("devuelve el libro, el resumen y cuánto falta por cada vía", async () => {
    const order = await checkout({ paymentMethod: "TRANSFER" });

    await OrderModel.registerPayment({
      tenantId: acme.id,
      orderId: order.id,
      kind: "PAYMENT",
      channel: "TRANSFER",
      amount: 1500,
      actorId: acmeAdminId,
    });

    const res = await request(app)
      .get(`/orders/${order.id}/payments`)
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.payments).toHaveLength(1);
    expect(res.body.payments[0]).toMatchObject({ channel: "TRANSFER", monto: 1500 });
    expect(res.body.payment.byChannel).toMatchObject({ TRANSFER: 1500, CASH: 0 });
    expect(res.body.pending).toEqual({
      CASH: 0,
      TRANSFER: order.total - 1500,
    });
  });

  it("no cruza tenants", async () => {
    const order = await draft();
    const { cookie: ajeno } = await loginAs(app, { email: "admin@shopco.com" });

    const res = await request(app)
      .get(`/orders/${order.id}/payments`)
      .set("Cookie", ajeno);

    expect(res.status).toBe(404);
  });
});

describe("las confirmaciones escriben en el mismo libro", () => {
  it("orden MIXED: transferencia y cobro total no duplican la parte transferida", async () => {
    const order = await checkout({
      paymentMethod: "MIXED",
      cashAmount: 1500,
      transferAmount: acmeVariant.price - 1500,
    });

    await OrderModel.confirmTransfer({
      tenantId: acme.id,
      orderId: order.id,
      confirmedById: acmeAdminId,
    });

    const [transferencia] = await paymentsOf(order.id);
    expect(transferencia).toMatchObject({
      channel: "TRANSFER",
      amount: order.transferAmount,
    });

    const saldada = await OrderModel.confirmPayment({
      tenantId: acme.id,
      orderId: order.id,
      confirmedById: acmeAdminId,
    });

    const filas = await paymentsOf(order.id);
    expect(filas).toHaveLength(2);
    expect(filas[1]).toMatchObject({ channel: "CASH", amount: order.cashAmount });
    expect(filas.reduce((sum, f) => sum + f.amount, 0)).toBe(order.total);
    expect(saldada.paymentStatus).toBe("PAID_IN_FULL");
  });

  it("confirmTransfer acepta el monto realmente recibido", async () => {
    const order = await checkout({ paymentMethod: "TRANSFER" });

    await OrderModel.confirmTransfer({
      tenantId: acme.id,
      orderId: order.id,
      confirmedById: acmeAdminId,
      amount: 1000,
    });

    const [fila] = await paymentsOf(order.id);
    expect(fila.amount).toBe(1000);

    // Con parte de la transferencia sin entrar, la orden todavía no se produce.
    const { blockers } = await OrderModel.getOrderById({
      tenantId: acme.id,
      orderId: order.id,
    }).then(async (o) => {
      const { evaluateOrder } = await import("../services/order-state.js");
      return evaluateOrder(o);
    });

    expect(blockers.map((b) => b.code)).toContain("TRANSFER_NOT_CONFIRMED");
  });

  it("la seña de una orden MIXED exige decir por qué vía entró", async () => {
    await seedTenantConfig(acme.id, { depositEnabled: true, depositPercentage: 50 });
    const order = await draft();
    await OrderModel.reviewOrder({
      tenantId: acme.id,
      orderId: order.id,
      reviewedById: acmeAdminId,
      fulfillment: {
        fulfillmentMethod: "PICKUP",
        paymentMethod: "MIXED",
        cashAmount: order.total / 2,
        transferAmount: order.total / 2,
      },
    });

    await expect(
      OrderModel.confirmDeposit({
        tenantId: acme.id,
        orderId: order.id,
        confirmedById: acmeAdminId,
      })
    ).rejects.toMatchObject({ code: "PAYMENT_CHANNEL_REQUIRED" });

    const conVia = await OrderModel.confirmDeposit({
      tenantId: acme.id,
      orderId: order.id,
      confirmedById: acmeAdminId,
      channel: "TRANSFER",
    });

    const [fila] = await paymentsOf(order.id);
    expect(fila).toMatchObject({ kind: "DEPOSIT", channel: "TRANSFER" });
    expect(conVia.paymentStatus).toBe("DEPOSIT_PAID");

    await seedTenantConfig(acme.id, { depositEnabled: false });
  });
});
