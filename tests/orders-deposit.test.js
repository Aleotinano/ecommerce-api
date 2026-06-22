import { describe, it, expect, beforeAll, afterAll } from "vitest";

const prisma = (await import("../lib/prisma.js")).default;
const { OrderModel } = await import("../services/orders.js");
const { seedTenants, seedTenantConfig } = await import("./helpers.js");

let acme;
let shopco;
let acmeVariant;
let acmeAdminId;

beforeAll(async () => {
  ({ acme, shopco } = await seedTenants());

  // Desvare = tenant con seña activa (50%). Acme hace de Desvare en este test.
  await seedTenantConfig(acme.id, { depositEnabled: true, depositPercentage: 50 });
  // shopco queda sin seña (default depositEnabled=false): camino convencional.
  await seedTenantConfig(shopco.id, {
    storeName: "ShopCo",
    contactPhone: "+540000000000",
  });

  acmeVariant = await prisma.productVariant.findFirst({
    where: { tenantId: acme.id },
  });
  acmeAdminId = acme.users.find((u) => u.role === "ADMIN").id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("createDraft (orden del bot)", () => {
  it("nace BOT, sin user, con seña resuelta server-side", async () => {
    const order = await OrderModel.createDraft({
      tenantId: acme.id,
      items: [{ variantId: acmeVariant.id, quantity: 2 }],
      contactPhone: "5491100000000",
      contactName: "Juan",
      creationContext: "Cliente: quiero 2\nAsistente: dale",
    });

    expect(order.origin).toBe("BOT");
    expect(order.userId).toBeNull();
    expect(order.status).toBe("PENDING");
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
      items: [{ variantId: variant.id, quantity: 1 }],
    });
    expect(order.requiresDeposit).toBe(false);
    expect(order.depositAmount).toBeNull();
  });
});

describe("guard PENDING → PROCESSING", () => {
  it("orden BOT sin revisar → ORDER_NOT_REVIEWED", async () => {
    const order = await OrderModel.createDraft({
      tenantId: acme.id,
      items: [{ variantId: acmeVariant.id, quantity: 1 }],
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
      items: [{ variantId: acmeVariant.id, quantity: 1 }],
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
      items: [{ variantId: acmeVariant.id, quantity: 1 }],
    });

    await OrderModel.reviewOrder({
      tenantId: acme.id,
      orderId: order.id,
      reviewedById: acmeAdminId,
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
      items: [{ variantId: acmeVariant.id, quantity: 4 }],
    });
    expect(order.total).toBe(acmeVariant.price * 4);

    const reviewed = await OrderModel.reviewOrder({
      tenantId: acme.id,
      orderId: order.id,
      reviewedById: acmeAdminId,
      items: [{ variantId: acmeVariant.id, quantity: 1 }],
    });

    expect(reviewed.reviewedById).toBe(acmeAdminId);
    expect(reviewed.reviewedAt).not.toBeNull();
    expect(reviewed.total).toBe(acmeVariant.price);
    expect(reviewed.depositAmount).toBe(acmeVariant.price / 2);
  });
});

describe("confirmDeposit", () => {
  it("orden sin seña → DEPOSIT_NOT_REQUIRED", async () => {
    const variant = await prisma.productVariant.findFirst({
      where: { tenantId: shopco.id },
    });
    const order = await OrderModel.createDraft({
      tenantId: shopco.id,
      items: [{ variantId: variant.id, quantity: 1 }],
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
      items: [{ variantId: acmeVariant.id, quantity: 1 }],
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
