import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

const prisma = (await import("../lib/prisma.js")).default;
const { app } = await import("../app.js");
const { OrderModel } = await import("../services/orders.js");
const { seedTenants, seedTenantConfig, loginAs } = await import("./helpers.js");

let acme;
let acmeVariant;
let acmeProductId;
let acmeAdminId;

beforeAll(async () => {
  ({ acme } = await seedTenants());
  // Seña activa: es el caso que exige que el cobro total arranque desde
  // DEPOSIT_PAID y no solo desde PENDING.
  await seedTenantConfig(acme.id, {
    depositEnabled: true,
    depositPercentage: 50,
  });

  acmeVariant = await prisma.productVariant.findFirst({
    where: { tenantId: acme.id },
  });
  acmeProductId = acmeVariant.productId;
  acmeAdminId = acme.users.find((u) => u.role === "ADMIN").id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function draft(quantity = 1) {
  return OrderModel.createDraft({
    tenantId: acme.id,
    items: [
      { productId: acmeProductId, variantId: acmeVariant.id, quantity },
    ],
  });
}

describe("confirmPayment", () => {
  it("desde PENDING deja la orden en PAID_IN_FULL y sella quién/cuándo", async () => {
    const order = await draft();
    expect(order.paymentStatus).toBe("PENDING");

    const paid = await OrderModel.confirmPayment({
      tenantId: acme.id,
      orderId: order.id,
      confirmedById: acmeAdminId,
      channel: "CASH",
    });

    expect(paid.paymentStatus).toBe("PAID_IN_FULL");
    expect(paid.paymentConfirmedById).toBe(acmeAdminId);
    expect(paid.paymentConfirmedAt).not.toBeNull();
    // El eje logístico no se toca: sigue siendo independiente del pago.
    expect(paid.status).toBe("NEW");
  });

  it("desde DEPOSIT_PAID cierra el saldo de una orden con seña", async () => {
    const order = await draft();
    await OrderModel.confirmDeposit({
      tenantId: acme.id,
      orderId: order.id,
      confirmedById: acmeAdminId,
      channel: "TRANSFER",
    });

    const paid = await OrderModel.confirmPayment({
      tenantId: acme.id,
      orderId: order.id,
      confirmedById: acmeAdminId,
      channel: "CASH",
    });

    expect(paid.paymentStatus).toBe("PAID_IN_FULL");

    // Cobra el SALDO, no el total de nuevo: la seña ya estaba registrada.
    const payments = await prisma.orderPayment.findMany({
      where: { orderId: order.id },
      orderBy: { id: "asc" },
    });
    expect(payments).toHaveLength(2);
    expect(payments[0]).toMatchObject({ kind: "DEPOSIT", channel: "TRANSFER" });
    expect(payments[1]).toMatchObject({ kind: "PAYMENT", channel: "CASH" });
    expect(payments[0].amount + payments[1].amount).toBe(order.total);
  });

  it("sin método de pago definido y sin channel → PAYMENT_CHANNEL_REQUIRED", async () => {
    // Las órdenes del bot nacen sin método de pago. Antes esto se cobraba igual y
    // la plata entraba a los libros sin vía; ahora hay que decir por dónde entró.
    const order = await draft();

    await expect(
      OrderModel.confirmPayment({
        tenantId: acme.id,
        orderId: order.id,
        confirmedById: acmeAdminId,
      })
    ).rejects.toMatchObject({ code: "PAYMENT_CHANNEL_REQUIRED" });
  });

  it("no pisa un pago escrito por MercadoPago → PAYMENT_NOT_CONFIRMABLE", async () => {
    const order = await draft();
    await prisma.order.update({
      where: { id: order.id },
      data: { paymentStatus: "APPROVED" },
    });

    await expect(
      OrderModel.confirmPayment({
        tenantId: acme.id,
        orderId: order.id,
        confirmedById: acmeAdminId,
      })
    ).rejects.toMatchObject({ code: "PAYMENT_NOT_CONFIRMABLE" });
  });

  it("una orden cancelada no se puede cobrar → ORDER_ALREADY_CANCELLED", async () => {
    const order = await draft();
    await OrderModel.updateOrderStatus({
      tenantId: acme.id,
      orderId: order.id,
      status: "CANCELLED",
    });

    await expect(
      OrderModel.confirmPayment({
        tenantId: acme.id,
        orderId: order.id,
        confirmedById: acmeAdminId,
      })
    ).rejects.toMatchObject({ code: "ORDER_ALREADY_CANCELLED" });
  });

  it("no cruza tenants → ORDER_NOT_FOUND", async () => {
    const order = await draft();

    await expect(
      OrderModel.confirmPayment({
        tenantId: acme.id + 999,
        orderId: order.id,
        confirmedById: acmeAdminId,
      })
    ).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
  });
});

describe("POST /orders/:id/confirm-payment", () => {
  it("ADMIN cobra la orden y la respuesta trae el estado nuevo", async () => {
    const order = await draft();
    const { cookie } = await loginAs(app, { email: "admin@acme.com" });

    const res = await request(app)
      .post(`/orders/${order.id}/confirm-payment`)
      .set("Cookie", cookie)
      .send({ channel: "CASH" });

    expect(res.status).toBe(200);
    expect(res.body.order.paymentStatus).toBe("PAID_IN_FULL");
    expect(res.body.order.paymentConfirmedAt).toBeTruthy();
  });

  it("sin sesión responde 401", async () => {
    const order = await draft();

    const res = await request(app)
      .post(`/orders/${order.id}/confirm-payment`)
      .send({});

    expect(res.status).toBe(401);
  });
});

describe("GET /orders/all", () => {
  it("expone el detalle de línea que necesita el panel (imagen, subtotal) y el sello de cobro", async () => {
    const order = await draft(3);
    await OrderModel.confirmPayment({
      tenantId: acme.id,
      orderId: order.id,
      confirmedById: acmeAdminId,
      channel: "CASH",
    });

    const { cookie } = await loginAs(app, { email: "admin@acme.com" });
    const res = await request(app).get("/orders/all").set("Cookie", cookie);

    expect(res.status).toBe(200);
    const listed = res.body.orders.find((o) => o.id === order.id);
    expect(listed).toBeDefined();
    expect(listed.paymentConfirmedAt).toBeTruthy();
    expect(listed.depositConfirmedAt).toBeDefined();

    const [line] = listed.productos;
    expect(line.subtotal).toBe(line.precio * line.cantidad);
    expect(line).toHaveProperty("image");
  });
});
