import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

const prisma = (await import("../lib/prisma.js")).default;
const { app } = await import("../app.js");
const { OrderModel } = await import("../services/orders.js");
const { CartModel } = await import("../services/cart.js");
const { evaluateOrder } = await import("../services/order-state.js");
const { seedTenants, seedTenantConfig, loginAs } = await import("./helpers.js");

// El avance automático: una orden entra sola a producción cuando se cumplen sus
// condiciones, en vez de esperar a que alguien se acuerde de apretar el botón.
// acme lleva seña (una condición más que destrabar), shopco no.

let acme;
let shopco;
let acmeVariant;
let shopcoVariant;
let acmeAdminId;

const historyOf = (orderId) =>
  prisma.orderStatusHistory.findMany({
    where: { orderId },
    orderBy: { createdAt: "asc" },
  });

beforeAll(async () => {
  ({ acme, shopco } = await seedTenants());
  await seedTenantConfig(acme.id, { depositEnabled: true, depositPercentage: 50 });
  await seedTenantConfig(shopco.id, { storeName: "ShopCo" });

  acmeVariant = await prisma.productVariant.findFirst({ where: { tenantId: acme.id } });
  shopcoVariant = await prisma.productVariant.findFirst({ where: { tenantId: shopco.id } });
  acmeAdminId = acme.users.find((u) => u.role === "ADMIN").id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

function draft(tenantId, variant, extra = {}) {
  return OrderModel.createDraft({
    tenantId,
    items: [{ productId: variant.productId, variantId: variant.id, quantity: 1 }],
    ...extra,
  });
}

describe("la revisión destraba y avanza", () => {
  it("con los datos completos, revisar deja la orden en PROCESSING sola", async () => {
    const order = await draft(shopco.id, shopcoVariant);
    expect(order.status).toBe("PENDING");

    const reviewed = await OrderModel.reviewOrder({
      tenantId: shopco.id,
      orderId: order.id,
      reviewedById: shopco.users.find((u) => u.role === "ADMIN").id,
      fulfillment: { fulfillmentMethod: "PICKUP", paymentMethod: "CASH" },
    });

    expect(reviewed.status).toBe("PROCESSING");

    // El avance queda auditado y distinguible de uno que apretó una persona.
    const [, avance] = await historyOf(order.id);
    expect(avance).toMatchObject({ toStatus: "PROCESSING", trigger: "AUTO" });
  });

  it("si todavía falta algo, no avanza y el panel ve el motivo", async () => {
    const order = await draft(shopco.id, shopcoVariant);

    // DELIVERY sin dirección: el pedido queda revisado pero no producible.
    const reviewed = await OrderModel.reviewOrder({
      tenantId: shopco.id,
      orderId: order.id,
      reviewedById: shopco.users.find((u) => u.role === "ADMIN").id,
      fulfillment: { fulfillmentMethod: "DELIVERY", paymentMethod: "CASH" },
    });

    expect(reviewed.status).toBe("PENDING");

    const { cookie } = await loginAs(app, { email: "admin@shopco.com" });
    const res = await request(app).get("/orders/all").set("Cookie", cookie);

    const listed = res.body.orders.find((o) => o.id === order.id);
    expect(listed.canProduce).toBe(false);
    expect(listed.blockers.map((b) => b.code)).toContain("ADDRESS_MISSING");
  });
});

describe("la confirmación del cobro destraba y avanza", () => {
  it("confirmar la seña deja la orden en PROCESSING", async () => {
    const order = await draft(acme.id, acmeVariant);

    // Con la seña impaga, revisar no alcanza.
    const reviewed = await OrderModel.reviewOrder({
      tenantId: acme.id,
      orderId: order.id,
      reviewedById: acmeAdminId,
      fulfillment: { fulfillmentMethod: "PICKUP", paymentMethod: "CASH" },
    });
    expect(reviewed.status).toBe("PENDING");

    const confirmed = await OrderModel.confirmDeposit({
      tenantId: acme.id,
      orderId: order.id,
      confirmedById: acmeAdminId,
    });

    expect(confirmed.status).toBe("PROCESSING");
    expect(confirmed.paymentStatus).toBe("DEPOSIT_PAID");

    const historial = await historyOf(order.id);
    expect(historial.at(-1)).toMatchObject({
      toStatus: "PROCESSING",
      trigger: "AUTO",
      changedById: acmeAdminId,
    });
  });

  it("con seña, la seña alcanza: no se exige además el total transferido", async () => {
    // La regla de dinero es UNA: si el tenant cobra seña, se produce contra la
    // seña y el saldo se cobra al entregar. Antes hacían falta las dos
    // confirmaciones, y la de transferencia terminaba sellando "cobré todo"
    // cuando lo que había entrado era solo la seña.
    const order = await draft(acme.id, acmeVariant);

    await OrderModel.reviewOrder({
      tenantId: acme.id,
      orderId: order.id,
      reviewedById: acmeAdminId,
      fulfillment: { fulfillmentMethod: "PICKUP", paymentMethod: "TRANSFER" },
    });

    const confirmed = await OrderModel.confirmDeposit({
      tenantId: acme.id,
      orderId: order.id,
      confirmedById: acmeAdminId,
    });

    expect(confirmed.status).toBe("PROCESSING");
    expect(confirmed.paymentStatus).toBe("DEPOSIT_PAID");
  });

  it("sin seña, una orden por transferencia espera a que la transferencia entre", async () => {
    const order = await draft(shopco.id, shopcoVariant);
    const shopcoAdmin = shopco.users.find((u) => u.role === "ADMIN");

    const reviewed = await OrderModel.reviewOrder({
      tenantId: shopco.id,
      orderId: order.id,
      reviewedById: shopcoAdmin.id,
      fulfillment: { fulfillmentMethod: "PICKUP", paymentMethod: "TRANSFER" },
    });
    expect(reviewed.status).toBe("PENDING");

    const confirmed = await OrderModel.confirmTransfer({
      tenantId: shopco.id,
      orderId: order.id,
      confirmedById: shopcoAdmin.id,
    });

    expect(confirmed.status).toBe("PROCESSING");
    // La transferencia entró completa: el pago queda saldado por el libro.
    expect(confirmed.paymentStatus).toBe("PAID_IN_FULL");
  });

  it("no empuja más allá de PROCESSING: READY y COMPLETED siguen siendo humanos", async () => {
    const order = await draft(acme.id, acmeVariant);

    await OrderModel.reviewOrder({
      tenantId: acme.id,
      orderId: order.id,
      reviewedById: acmeAdminId,
      fulfillment: { fulfillmentMethod: "PICKUP", paymentMethod: "CASH" },
    });
    await OrderModel.confirmDeposit({
      tenantId: acme.id,
      orderId: order.id,
      confirmedById: acmeAdminId,
    });
    const paid = await OrderModel.confirmPayment({
      tenantId: acme.id,
      orderId: order.id,
      confirmedById: acmeAdminId,
    });

    expect(paid.paymentStatus).toBe("PAID_IN_FULL");
    expect(paid.status).toBe("PROCESSING");
  });
});

describe("lo que NO se automatiza", () => {
  it("crear no es empezar a producir: una orden ADMIN completa nace PENDING", async () => {
    const customer = shopco.users.find((u) => u.role === "CUSTOMER");

    await CartModel.add({
      tenantId: shopco.id,
      userId: customer.id,
      productId: shopcoVariant.productId,
      variantId: shopcoVariant.id,
    });

    // Origen ADMIN, sin seña y con entrega y pago definidos: no le falta nada
    // para producirse. Aun así nace PENDING — cargar un pedido en el mostrador
    // no significa ponerse a hacerlo, y esa decisión sigue siendo de quien
    // atiende.
    const order = await OrderModel.create({
      tenantId: shopco.id,
      userId: customer.id,
      fulfillmentMethod: "PICKUP",
      paymentMethod: "CASH",
    });

    expect(order.status).toBe("PENDING");
    expect(evaluateOrder(order).canProduce).toBe(true);
  });
});

describe("READY, el paso nuevo", () => {
  it("PROCESSING → READY → COMPLETED, y no se puede volver atrás", async () => {
    const order = await draft(shopco.id, shopcoVariant);
    const shopcoAdmin = shopco.users.find((u) => u.role === "ADMIN");

    await OrderModel.reviewOrder({
      tenantId: shopco.id,
      orderId: order.id,
      reviewedById: shopcoAdmin.id,
      fulfillment: { fulfillmentMethod: "PICKUP", paymentMethod: "CASH" },
    });

    const { cookie } = await loginAs(app, { email: "admin@shopco.com" });

    const ready = await request(app)
      .patch(`/orders/${order.id}`)
      .set("Cookie", cookie)
      .send({ status: "READY", note: "Retira el sábado" });

    expect(ready.status).toBe(200);
    expect(ready.body.order.status).toBe("READY");

    const backwards = await request(app)
      .patch(`/orders/${order.id}`)
      .set("Cookie", cookie)
      .send({ status: "PROCESSING" });

    expect(backwards.status).toBe(400);
    expect(backwards.body.error.code).toBe("INVALID_STATUS_TRANSITION");

    const completed = await request(app)
      .patch(`/orders/${order.id}`)
      .set("Cookie", cookie)
      .send({ status: "COMPLETED" });

    expect(completed.status).toBe(200);
    expect(completed.body.order.status).toBe("COMPLETED");
  });

  it("el timeline marca qué avance fue automático", async () => {
    const order = await draft(shopco.id, shopcoVariant);
    const shopcoAdmin = shopco.users.find((u) => u.role === "ADMIN");

    await OrderModel.reviewOrder({
      tenantId: shopco.id,
      orderId: order.id,
      reviewedById: shopcoAdmin.id,
      fulfillment: { fulfillmentMethod: "PICKUP", paymentMethod: "CASH" },
    });

    const { cookie } = await loginAs(app, { email: "admin@shopco.com" });
    const res = await request(app).get(`/orders/${order.id}`).set("Cookie", cookie);

    const timeline = res.body.order.timeline;
    expect(timeline[0]).toMatchObject({ estado: "PENDING", automatico: false });
    expect(timeline.at(-1)).toMatchObject({ estado: "PROCESSING", automatico: true });
  });
});
