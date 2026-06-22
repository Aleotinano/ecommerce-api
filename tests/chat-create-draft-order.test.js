import { describe, it, expect, beforeAll, afterAll } from "vitest";

const prisma = (await import("../lib/prisma.js")).default;
const { buildToolContext } = await import("../services/chat/tools.js");
const { seedTenants, seedTenantConfig } = await import("./helpers.js");

let acme;
let singleProductId;
let multiProductId;

const whatsappChannel = (overrides = {}) => ({
  kind: "whatsapp",
  waId: "5491100000000",
  contactName: "Juan",
  history: [
    { role: "user", content: "hola, tenes la remera basica?" },
    { role: "assistant", content: "si! viene en negro M" },
  ],
  message: "dale, quiero 2",
  ...overrides,
});

const ctxFor = (channel) =>
  buildToolContext({
    tenantId: acme.id,
    user: null,
    config: { showOutOfStock: true },
    channel,
  });

beforeAll(async () => {
  ({ acme } = await seedTenants());
  await seedTenantConfig(acme.id, { depositEnabled: true, depositPercentage: 50 });

  const singleVariantProduct = await prisma.product.findFirst({
    where: { tenantId: acme.id },
  });
  singleProductId = singleVariantProduct.id;

  // Producto con 2 variantes (mismo color, distinto talle) para el caso ambiguo.
  const multi = await prisma.product.create({
    data: {
      tenantId: acme.id,
      name: "Buzo",
      price: 12000,
      variants: {
        create: [
          { tenantId: acme.id, color: "negro", size: "M", price: 12000, stock: 5, sku: "ACM-BUZ-NM" },
          { tenantId: acme.id, color: "negro", size: "L", price: 12000, stock: 5, sku: "ACM-BUZ-NL" },
        ],
      },
    },
  });
  multiProductId = multi.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("createDraftOrder tool", () => {
  it("se ofrece en WhatsApp y NO en el chat web", () => {
    const wa = ctxFor(whatsappChannel());
    const web = ctxFor(null);

    expect(wa.tools.some((t) => t.name === "createDraftOrder")).toBe(true);
    expect(web.tools.some((t) => t.name === "createDraftOrder")).toBe(false);
  });

  it("no se ejecuta sin canal (web): devuelve error y no crea orden", async () => {
    const web = ctxFor(null);
    const res = await web.executeTool("createDraftOrder", {
      items: [{ productId: singleProductId, quantity: 1 }],
    });
    expect(res.error).toBeDefined();
    expect(res.created).toBeUndefined();
  });

  it("crea borrador BOT con seña y contexto resueltos server-side", async () => {
    const wa = ctxFor(whatsappChannel());
    const variant = await prisma.productVariant.findFirst({
      where: { productId: singleProductId },
    });

    const res = await wa.executeTool("createDraftOrder", {
      items: [{ productId: singleProductId, quantity: 2 }],
    });

    expect(res.created).toBe(true);
    expect(res.total).toBe(variant.price * 2);
    expect(res.requiereSena).toBe(true);
    expect(res.sena).toBe((variant.price * 2) / 2);

    const order = await prisma.order.findUnique({
      where: { id: res.pedido },
      include: { orderItems: true },
    });
    expect(order.origin).toBe("BOT");
    expect(order.userId).toBeNull();
    expect(order.paymentStatus).toBe("PENDING");
    expect(order.contactPhone).toBe("5491100000000");
    expect(order.contactName).toBe("Juan");
    expect(order.creationContext).toContain("Cliente: dale, quiero 2");
    expect(order.orderItems[0].quantity).toBe(2);
  });

  it("variante ambigua → pide precisar y no crea orden", async () => {
    const wa = ctxFor(whatsappChannel());
    const before = await prisma.order.count({ where: { tenantId: acme.id } });

    const res = await wa.executeTool("createDraftOrder", {
      items: [{ productId: multiProductId, quantity: 1 }],
    });

    expect(res.error).toMatch(/color|talle/i);
    const after = await prisma.order.count({ where: { tenantId: acme.id } });
    expect(after).toBe(before);
  });

  it("cantidad inválida → error, sin crear orden", async () => {
    const wa = ctxFor(whatsappChannel());
    const res = await wa.executeTool("createDraftOrder", {
      items: [{ productId: singleProductId, quantity: 0 }],
    });
    expect(res.error).toBeDefined();
    expect(res.created).toBeUndefined();
  });
});
