import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

const prisma = (await import("../lib/prisma.js")).default;
const { app } = await import("../app.js");
const { OrderModel } = await import("../services/orders.js");
const { seedTenants, seedTenantConfig, loginAs } = await import(
  "./helpers.js"
);

let acme;
let shopco;
let acmeVariant;
let acmeProductId;
let acmeAdminId;

beforeAll(async () => {
  ({ acme, shopco } = await seedTenants());

  // acme = tenant con seña activa (50%) en este test.
  await seedTenantConfig(acme.id, { depositEnabled: true, depositPercentage: 50 });
  // shopco queda sin seña (default depositEnabled=false): camino convencional.
  await seedTenantConfig(shopco.id, {
    storeName: "ShopCo",
    contactPhone: "+540000000000",
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

describe("createDraft (orden del bot)", () => {
  it("nace BOT, sin user, con seña resuelta server-side", async () => {
    const order = await OrderModel.createDraft({
      tenantId: acme.id,
      items: [{ productId: acmeProductId, variantId: acmeVariant.id, quantity: 2 }],
      contactPhone: "5491100000000",
      contactName: "Juan",
      creationContext: "Cliente: quiero 2\nAsistente: dale",
    });

    expect(order.origin).toBe("BOT");
    expect(order.userId).toBeNull();
    expect(order.status).toBe("NEW");
    expect(order.paymentStatus).toBe("PENDING");
    expect(order.reviewedById).toBeNull();
    expect(order.total).toBe(acmeVariant.price * 2);
    expect(order.requiresDeposit).toBe(true);
    expect(order.depositAmount).toBe((acmeVariant.price * 2) / 2);
    expect(order.contactPhone).toBe("5491100000000");
    expect(order.creationContext).toContain("Cliente: quiero 2");
  });

  it("en tenant sin seña: requiresDeposit false y depositAmount null", async () => {
    const variant = await prisma.productVariant.findFirst({
      where: { tenantId: shopco.id },
    });
    const order = await OrderModel.createDraft({
      tenantId: shopco.id,
      items: [{ productId: variant.productId, variantId: variant.id, quantity: 1 }],
    });
    expect(order.requiresDeposit).toBe(false);
    expect(order.depositAmount).toBeNull();
  });
});

describe("guard NEW → PROCESSING", () => {
  it("orden BOT sin revisar → ORDER_NOT_REVIEWED", async () => {
    const order = await OrderModel.createDraft({
      tenantId: acme.id,
      items: [{ productId: acmeProductId, variantId: acmeVariant.id, quantity: 1 }],
    });

    await expect(
      OrderModel.updateOrderStatus({
        tenantId: acme.id,
        orderId: order.id,
        status: "PROCESSING",
      })
    ).rejects.toMatchObject({ code: "ORDER_NOT_REVIEWED" });
  });

  it("revisada pero sin seña confirmada → DEPOSIT_NOT_CONFIRMED", async () => {
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
    ).rejects.toMatchObject({ code: "DEPOSIT_NOT_CONFIRMED" });
  });

  it("revisada + seña confirmada → la transición procede", async () => {
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
    await OrderModel.confirmDeposit({
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
});

describe("reviewOrder con corrección de cantidades", () => {
  it("re-resuelve total y recalcula depositAmount server-side", async () => {
    const order = await OrderModel.createDraft({
      tenantId: acme.id,
      items: [{ productId: acmeProductId, variantId: acmeVariant.id, quantity: 4 }],
    });
    expect(order.total).toBe(acmeVariant.price * 4);

    const reviewed = await OrderModel.reviewOrder({
      tenantId: acme.id,
      orderId: order.id,
      reviewedById: acmeAdminId,
      items: [{ id: order.orderItems[0].id, quantity: 1 }],
    });

    expect(reviewed.reviewedById).toBe(acmeAdminId);
    expect(reviewed.reviewedAt).not.toBeNull();
    expect(reviewed.total).toBe(acmeVariant.price);
    expect(reviewed.depositAmount).toBe(acmeVariant.price / 2);
  });

  it("edita solo la fila indicada por id, aunque haya 2 líneas de la misma variante", async () => {
    const order = await OrderModel.createDraft({
      tenantId: acme.id,
      items: [
        { productId: acmeProductId, variantId: acmeVariant.id, quantity: 1, note: "sin nueces" },
        {
          productId: acmeProductId,
          variantId: acmeVariant.id,
          quantity: 2,
          note: "sin nueces ni pasas",
        },
      ],
    });
    expect(order.orderItems).toHaveLength(2);

    const targetItem = order.orderItems.find(
      (it) => it.note === "sin nueces"
    );
    const untouchedItem = order.orderItems.find(
      (it) => it.id !== targetItem.id
    );

    const reviewed = await OrderModel.reviewOrder({
      tenantId: acme.id,
      orderId: order.id,
      reviewedById: acmeAdminId,
      items: [{ id: targetItem.id, quantity: 5, note: "sin nueces, doble porción" }],
    });

    const updatedTarget = reviewed.orderItems.find(
      (it) => it.id === targetItem.id
    );
    const stillUntouched = reviewed.orderItems.find(
      (it) => it.id === untouchedItem.id
    );

    expect(updatedTarget.quantity).toBe(5);
    expect(updatedTarget.note).toBe("sin nueces, doble porción");
    expect(stillUntouched.quantity).toBe(untouchedItem.quantity);
    expect(stillUntouched.note).toBe(untouchedItem.note);
  });

  it("permite borrar la nota mandando note: null explícito", async () => {
    const order = await OrderModel.createDraft({
      tenantId: acme.id,
      items: [
        {
          productId: acmeProductId,
          variantId: acmeVariant.id,
          quantity: 1,
          note: "dedicatoria: Juan",
        },
      ],
    });

    const reviewed = await OrderModel.reviewOrder({
      tenantId: acme.id,
      orderId: order.id,
      reviewedById: acmeAdminId,
      items: [{ id: order.orderItems[0].id, quantity: 1, note: null }],
    });

    expect(reviewed.orderItems[0].note).toBeNull();
  });
});

describe("GET /orders/:id como ADMIN sobre una orden BOT (userId null)", () => {
  it("devuelve el detalle en vez de 404", async () => {
    const order = await OrderModel.createDraft({
      tenantId: acme.id,
      items: [{ productId: acmeProductId, variantId: acmeVariant.id, quantity: 1 }],
    });
    expect(order.userId).toBeNull();

    const { cookie } = await loginAs(app, { email: "admin@acme.com" });

    const res = await request(app)
      .get(`/orders/${order.id}`)
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.order.id).toBe(order.id);
  });
});

describe("confirmDeposit", () => {
  it("orden sin seña → DEPOSIT_NOT_REQUIRED", async () => {
    const variant = await prisma.productVariant.findFirst({
      where: { tenantId: shopco.id },
    });
    const order = await OrderModel.createDraft({
      tenantId: shopco.id,
      items: [{ productId: variant.productId, variantId: variant.id, quantity: 1 }],
    });

    await expect(
      OrderModel.confirmDeposit({
        tenantId: shopco.id,
        orderId: order.id,
        confirmedById: 1,
      })
    ).rejects.toMatchObject({ code: "DEPOSIT_NOT_REQUIRED" });
  });

  it("no pisa un pago ya APPROVED (no es PENDING) → DEPOSIT_NOT_CONFIRMABLE", async () => {
    const order = await OrderModel.createDraft({
      tenantId: acme.id,
      items: [{ productId: acmeProductId, variantId: acmeVariant.id, quantity: 1 }],
    });
    await prisma.order.update({
      where: { id: order.id },
      data: { paymentStatus: "APPROVED" },
    });

    await expect(
      OrderModel.confirmDeposit({
        tenantId: acme.id,
        orderId: order.id,
        confirmedById: acmeAdminId,
      })
    ).rejects.toMatchObject({ code: "DEPOSIT_NOT_CONFIRMABLE" });
  });
});
