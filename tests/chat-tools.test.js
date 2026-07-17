import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import prisma from "../lib/prisma.js";
import { seedTenants } from "./helpers.js";
import { buildToolContext } from "../services/chat/tools.js";
import { OrderModel } from "../services/orders.js";
import { AUTHENTICATED_TOOLS } from "../lib/llm/tools/schema.js";

let acme;
let shopco;

beforeAll(async () => {
  ({ acme, shopco } = await seedTenants());

  // Producto sin stock en acme para probar el filtro showOutOfStock.
  await prisma.product.create({
    data: {
      tenantId: acme.id,
      name: "Remera agotada",
      type: "PRODUCTO",
      variants: {
        create: {
          tenantId: acme.id,
          attributes: { color: "blanco", talle: "L" },
          price: 5000,
          stock: 0,
          sku: "ACM-REM-AGOT",
          isDefault: true,
        },
      },
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("chat tools — seguridad multi-tenant", () => {
  it("el tenantId sale del servidor, NUNCA de los args del LLM", async () => {
    // Closure con tenant acme; el LLM 'intenta' pasar el tenant de shopco.
    const { executeTool } = buildToolContext({ tenantId: acme.id, user: null });

    const out = await executeTool("searchProducts", {
      tenantId: shopco.id, // debe ser ignorado
      query: "Auriculares", // producto de shopco
    });

    const names = out.productos.map((p) => p.name);
    expect(names).not.toContain("Auriculares BT");
  });

  it("searchProducts devuelve vista limitada sin sku ni imgPublicId", async () => {
    const { executeTool } = buildToolContext({ tenantId: acme.id, user: null });
    const out = await executeTool("searchProducts", { query: "Remera básica" });

    expect(out.productos.length).toBeGreaterThan(0);
    const p = out.productos[0];
    expect(p).toHaveProperty("name");
    expect(p).toHaveProperty("precio");
    expect(p).toHaveProperty("hayStock");
    expect(p).not.toHaveProperty("sku");
    expect(p).not.toHaveProperty("imgPublicId");
    expect(JSON.stringify(out)).not.toMatch(/sku|imgPublicId/i);
  });

  it("respeta showOutOfStock=false: oculta productos sin stock", async () => {
    const { executeTool } = buildToolContext({
      tenantId: acme.id,
      user: null,
      config: { showOutOfStock: false },
    });
    const out = await executeTool("searchProducts", {});
    const names = out.productos.map((p) => p.name);
    expect(names).not.toContain("Remera agotada");
  });

  it("showOutOfStock=true: incluye productos sin stock", async () => {
    const { executeTool } = buildToolContext({
      tenantId: acme.id,
      user: null,
      config: { showOutOfStock: true },
    });
    const out = await executeTool("searchProducts", {});
    const agotada = out.productos.find((p) => p.name === "Remera agotada");
    expect(agotada).toBeDefined();
    expect(agotada.hayStock).toBe(false);
  });

  it("getProductDetail no expone sku ni imgPublicId", async () => {
    const product = await prisma.product.findFirst({
      where: { tenantId: acme.id, name: "Remera básica" },
    });
    const { executeTool } = buildToolContext({
      tenantId: acme.id,
      user: null,
      config: { showOutOfStock: true },
    });

    const out = await executeTool("getProductDetail", { productId: product.id });
    expect(out.name).toBe("Remera básica");
    expect(out.variantes[0]).toHaveProperty("disponible");
    expect(JSON.stringify(out)).not.toMatch(/sku|imgPublicId/i);
  });

  it("checkAvailability informa disponibilidad de una variante", async () => {
    const product = await prisma.product.findFirst({
      where: { tenantId: acme.id, name: "Remera básica" },
    });
    const { executeTool } = buildToolContext({ tenantId: acme.id, user: null });

    const out = await executeTool("checkAvailability", {
      productId: product.id,
      attributes: { color: "negro", talle: "M" },
    });
    expect(out.disponible).toBe(true);
    expect(out.stock).toBeGreaterThan(0);
  });
});

describe("chat tools — gating de tools por auth", () => {
  it("getMyOrderStatus NO se ofrece a un usuario anonimo", () => {
    const { tools } = buildToolContext({ tenantId: acme.id, user: null });
    const names = tools.map((t) => t.name);
    for (const authTool of AUTHENTICATED_TOOLS) {
      expect(names).not.toContain(authTool);
    }
  });

  it("getMyOrderStatus SI se ofrece a un cliente logueado", () => {
    const { tools } = buildToolContext({
      tenantId: acme.id,
      user: { id: 1 },
    });
    expect(tools.map((t) => t.name)).toContain("getMyOrderStatus");
  });

  it("un anonimo nunca ejecuta getMyOrderStatus aunque la invoque", async () => {
    const { executeTool } = buildToolContext({ tenantId: acme.id, user: null });
    const out = await executeTool("getMyOrderStatus", { orderId: 1 });
    expect(out.error).toBeDefined();
  });

  it("getMyOrderStatus scopea por user.id del servidor, no por args", async () => {
    const spy = vi
      .spyOn(OrderModel, "getUserOrderById")
      .mockResolvedValue({
        status: "PENDING",
        total: 4500,
        createdAt: new Date(),
        orderItems: [{ quantity: 2, variant: { product: { name: "Remera básica" } } }],
      });

    const { executeTool } = buildToolContext({
      tenantId: acme.id,
      user: { id: 42 },
    });

    // El LLM 'intenta' colar userId/tenantId ajenos: deben ignorarse.
    await executeTool("getMyOrderStatus", { orderId: 7, userId: 999, tenantId: 999 });

    expect(spy).toHaveBeenCalledWith({
      tenantId: acme.id,
      userId: 42,
      orderId: 7,
    });

    spy.mockRestore();
  });
});
