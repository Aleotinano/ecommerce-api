import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

const prisma = (await import("../lib/prisma.js")).default;
const { app } = await import("../app.js");
const { OrderModel } = await import("../services/orders.js");
const { CartModel } = await import("../services/cart.js");
const { seedTenants, seedTenantConfig, bearerFor } = await import(
  "./helpers.js"
);

let acme;
let acmeVariant;
let acmeProductId;
let acmeCustomer;
let acmeAdminId;
let acmeCustomerBearer;

async function addToCart() {
  await CartModel.add({
    tenantId: acme.id,
    userId: acmeCustomer.id,
    productId: acmeProductId,
    variantId: acmeVariant.id,
  });
}

beforeAll(async () => {
  ({ acme } = await seedTenants());
  await seedTenantConfig(acme.id);

  acmeVariant = await prisma.productVariant.findFirst({
    where: { tenantId: acme.id },
  });
  acmeProductId = acmeVariant.productId;
  acmeCustomer = acme.users.find((u) => u.role === "CUSTOMER");
  acmeAdminId = acme.users.find((u) => u.role === "ADMIN").id;
  acmeCustomerBearer = bearerFor(acmeCustomer);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("OrderModel.create — fulfillment y payment method", () => {
  it("DELIVERY + CASH con addressText → se persiste", async () => {
    await addToCart();
    const order = await OrderModel.create({
      tenantId: acme.id,
      userId: acmeCustomer.id,
      fulfillmentMethod: "DELIVERY",
      addressText: "Av. Siempre Viva 742",
      addressDetails: "rejas grises",
      paymentMethod: "CASH",
    });

    expect(order.fulfillmentMethod).toBe("DELIVERY");
    expect(order.addressText).toBe("Av. Siempre Viva 742");
    expect(order.addressDetails).toBe("rejas grises");
    expect(order.paymentMethod).toBe("CASH");
  });

  it("PICKUP + MIXED sin dirección → se persiste igual, con paymentNote", async () => {
    await addToCart();
    // MIXED exige que el desglose cierre contra el total, que se calcula
    // server-side desde el carrito: lo miramos primero para partirlo.
    const total = acmeVariant.price;
    const order = await OrderModel.create({
      tenantId: acme.id,
      userId: acmeCustomer.id,
      fulfillmentMethod: "PICKUP",
      paymentMethod: "MIXED",
      cashAmount: total / 2,
      transferAmount: total / 2,
      paymentNote: "transfiere la mitad, resto efectivo",
    });

    expect(order.fulfillmentMethod).toBe("PICKUP");
    expect(order.addressText).toBeNull();
    expect(order.paymentMethod).toBe("MIXED");
    expect(order.paymentNote).toBe("transfiere la mitad, resto efectivo");
  });
});

describe("POST /store/orders — validación Zod", () => {
  it("DELIVERY sin addressText → 400", async () => {
    await addToCart();
    const res = await request(app)
      .post("/store/orders")
      .set("X-Tenant-Slug", "acme")
      .set("Authorization", acmeCustomerBearer)
      .send({ fulfillmentMethod: "DELIVERY", paymentMethod: "CASH" });

    expect(res.status).toBe(400);
  });

  it("PICKUP + CASH sin dirección → 201", async () => {
    await addToCart();
    const res = await request(app)
      .post("/store/orders")
      .set("X-Tenant-Slug", "acme")
      .set("Authorization", acmeCustomerBearer)
      .send({ fulfillmentMethod: "PICKUP", paymentMethod: "CASH" });

    expect(res.status).toBe(201);
    expect(res.body.order.fulfillmentMethod).toBe("PICKUP");
  });

  it("addressLat sin addressLng → 400", async () => {
    await addToCart();
    const res = await request(app)
      .post("/store/orders")
      .set("X-Tenant-Slug", "acme")
      .set("Authorization", acmeCustomerBearer)
      .send({
        fulfillmentMethod: "DELIVERY",
        addressText: "Calle Falsa 123",
        addressLat: -34.6,
        paymentMethod: "CASH",
      });

    expect(res.status).toBe(400);
  });
});

describe("guard NEW → PROCESSING: fulfillment/payment", () => {
  it("orden BOT revisada pero sin fulfillment/payment → FULFILLMENT_INCOMPLETE", async () => {
    const order = await OrderModel.createDraft({
      tenantId: acme.id,
      items: [{ productId: acmeProductId, variantId: acmeVariant.id, quantity: 1 }],
    });
    await OrderModel.reviewOrder({
      tenantId: acme.id,
      orderId: order.id,
      reviewedById: acmeAdminId,
    });

    await expect(
      OrderModel.updateOrderStatus({
        tenantId: acme.id,
        orderId: order.id,
        status: "PROCESSING",
      })
    ).rejects.toMatchObject({ code: "FULFILLMENT_INCOMPLETE" });
  });

  it("DELIVERY sin addressText (seteado directo, sin pasar por Zod) → ADDRESS_MISSING", async () => {
    const order = await OrderModel.createDraft({
      tenantId: acme.id,
      items: [{ productId: acmeProductId, variantId: acmeVariant.id, quantity: 1 }],
    });
    await OrderModel.reviewOrder({
      tenantId: acme.id,
      orderId: order.id,
      reviewedById: acmeAdminId,
      fulfillment: { fulfillmentMethod: "DELIVERY", paymentMethod: "CASH" },
    });

    await expect(
      OrderModel.updateOrderStatus({
        tenantId: acme.id,
        orderId: order.id,
        status: "PROCESSING",
      })
    ).rejects.toMatchObject({ code: "ADDRESS_MISSING" });
  });

  it("TRANSFER sin confirmar → TRANSFER_NOT_CONFIRMED; tras confirmTransfer, procede", async () => {
    const order = await OrderModel.createDraft({
      tenantId: acme.id,
      items: [{ productId: acmeProductId, variantId: acmeVariant.id, quantity: 1 }],
    });
    await OrderModel.reviewOrder({
      tenantId: acme.id,
      orderId: order.id,
      reviewedById: acmeAdminId,
      fulfillment: { fulfillmentMethod: "PICKUP", paymentMethod: "TRANSFER" },
    });

    await expect(
      OrderModel.updateOrderStatus({
        tenantId: acme.id,
        orderId: order.id,
        status: "PROCESSING",
      })
    ).rejects.toMatchObject({ code: "TRANSFER_NOT_CONFIRMED" });

    await OrderModel.confirmTransfer({
      tenantId: acme.id,
      orderId: order.id,
      confirmedById: acmeAdminId,
    });

    const updated = await OrderModel.updateOrderStatus({
      tenantId: acme.id,
      orderId: order.id,
      status: "PROCESSING",
    });
    expect(updated.status).toBe("PROCESSING");
  });

  it("CASH pasa a PROCESSING sin necesidad de confirmar transferencia", async () => {
    const order = await OrderModel.createDraft({
      tenantId: acme.id,
      items: [{ productId: acmeProductId, variantId: acmeVariant.id, quantity: 1 }],
    });
    await OrderModel.reviewOrder({
      tenantId: acme.id,
      orderId: order.id,
      reviewedById: acmeAdminId,
      fulfillment: { fulfillmentMethod: "PICKUP", paymentMethod: "CASH" },
    });

    const updated = await OrderModel.updateOrderStatus({
      tenantId: acme.id,
      orderId: order.id,
      status: "PROCESSING",
    });
    expect(updated.status).toBe("PROCESSING");
  });
});

describe("confirmTransfer", () => {
  it("orden CASH → TRANSFER_NOT_APPLICABLE", async () => {
    await addToCart();
    const order = await OrderModel.create({
      tenantId: acme.id,
      userId: acmeCustomer.id,
      fulfillmentMethod: "PICKUP",
      paymentMethod: "CASH",
    });

    await expect(
      OrderModel.confirmTransfer({
        tenantId: acme.id,
        orderId: order.id,
        confirmedById: acmeAdminId,
      })
    ).rejects.toMatchObject({ code: "TRANSFER_NOT_APPLICABLE" });
  });

  it("ya confirmada → TRANSFER_ALREADY_CONFIRMED", async () => {
    await addToCart();
    const order = await OrderModel.create({
      tenantId: acme.id,
      userId: acmeCustomer.id,
      fulfillmentMethod: "PICKUP",
      paymentMethod: "TRANSFER",
    });

    await OrderModel.confirmTransfer({
      tenantId: acme.id,
      orderId: order.id,
      confirmedById: acmeAdminId,
    });

    await expect(
      OrderModel.confirmTransfer({
        tenantId: acme.id,
        orderId: order.id,
        confirmedById: acmeAdminId,
      })
    ).rejects.toMatchObject({ code: "TRANSFER_ALREADY_CONFIRMED" });
  });
});
