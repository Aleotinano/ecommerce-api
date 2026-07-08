import { describe, it, expect, beforeAll, afterAll } from "vitest";
import prisma from "../lib/prisma.js";
import { getProductPrice } from "../helpers/price.js";
import { ProductModel } from "../services/productos.js";
import { seedTenants } from "./helpers.js";

let tenant;

beforeAll(async () => {
  const { acme } = await seedTenants();
  tenant = acme;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Resolución de precios", () => {
  it("variante con precio → retorna precio de variante", () => {
    const variant = { price: 5000 };
    const product = { price: 2000 };

    const price = getProductPrice(variant, product);
    expect(price).toBe(5000);
  });

  it("variante sin precio, producto con precio → retorna precio del producto", () => {
    const variant = { price: null };
    const product = { price: 3500 };

    const price = getProductPrice(variant, product);
    expect(price).toBe(3500);
  });

  it("ambos sin precio → retorna null", () => {
    const variant = { price: null };
    const product = { price: null };

    const price = getProductPrice(variant, product);
    expect(price).toBeNull();
  });

  it("undefined en ambos → retorna null", () => {
    const variant = {};
    const product = {};

    const price = getProductPrice(variant, product);
    expect(price).toBeNull();
  });

  it("variante 0 es válido (precio cero) → retorna 0", () => {
    const variant = { price: 0 };
    const product = { price: 100 };

    const price = getProductPrice(variant, product);
    expect(price).toBe(0);
  });
});

describe("Productos con precios en BD", () => {
  it("crear producto con precio", async () => {
    const product = await prisma.product.create({
      data: {
        tenantId: tenant.id,
        name: "Remera premium",
        description: "Remera con precio global",
        price: 3500,
        type: "UNIDAD",
      },
    });

    expect(product.price).toBe(3500);
    expect(product.id).toBeDefined();
  });

  it("el precio del producto es obligatorio (rechaza crear sin precio)", async () => {
    await expect(
      prisma.product.create({
        data: {
          tenantId: tenant.id,
          name: "Producto sin precio",
          description: "Sin precio inicial",
          type: "UNIDAD",
        },
      })
    ).rejects.toThrow();
  });

  it("actualizar precio del producto", async () => {
    const product = await prisma.product.create({
      data: {
        tenantId: tenant.id,
        name: "Producto actualizable",
        price: 1000,
        type: "UNIDAD",
      },
    });

    const updated = await prisma.product.update({
      where: { id: product.id },
      data: { price: 2500 },
    });

    expect(updated.price).toBe(2500);
  });

  it("obtener producto incluye precio", async () => {
    const product = await prisma.product.create({
      data: {
        tenantId: tenant.id,
        name: "Producto consulta",
        price: 4200,
        type: "UNIDAD",
      },
    });

    const fetched = await prisma.product.findUnique({
      where: { id: product.id },
    });

    expect(fetched.price).toBe(4200);
  });

  it("variante con precio tiene prioridad sobre precio del producto", async () => {
    const product = await prisma.product.create({
      data: {
        tenantId: tenant.id,
        name: "Producto multi-precio",
        price: 2000,
        type: "VARIANTE",
      },
    });

    const variant = await prisma.productVariant.create({
      data: {
        tenantId: tenant.id,
        productId: product.id,
        color: "azul",
        size: "M",
        price: 3500,
        stock: 20,
        sku: "TEST-OVERRIDE-1",
      },
    });

    // Variante tiene precio, debe tener prioridad sobre producto
    const resolvedPrice = getProductPrice(variant, product);
    expect(resolvedPrice).toBe(3500);
  });
});

describe("Producto UNIDAD (preset Mesa Dulce, sin variantes)", () => {
  it("crear con type=UNIDAD y stock → stock/precio viven en Product, sin ProductVariant", async () => {
    const product = await ProductModel.create({
      tenantId: tenant.id,
      name: "Torta de chocolate",
      description: "Torta entera, sin variantes",
      price: 8000,
      type: "UNIDAD",
      stock: 5,
    });

    expect(product.type).toBe("UNIDAD");
    expect(product.stock).toBe(5);
    expect(product.variants).toHaveLength(0);
  });

  it("crear type=UNIDAD y sin stock → falla con STOCK_REQUIRED", async () => {
    await expect(
      ProductModel.create({
        tenantId: tenant.id,
        name: "Torta sin stock",
        price: 8000,
        type: "UNIDAD",
      })
    ).rejects.toMatchObject({ code: "STOCK_REQUIRED" });
  });

  it("crear type=UNIDAD con variants → falla con VARIANTS_NOT_ALLOWED", async () => {
    await expect(
      ProductModel.create({
        tenantId: tenant.id,
        name: "Torta con variantes de más",
        price: 8000,
        type: "UNIDAD",
        stock: 5,
        variants: [{ color: "#fff", stock: 1, sku: "X" }],
      })
    ).rejects.toMatchObject({ code: "VARIANTS_NOT_ALLOWED" });
  });

  it("crear type=VARIANTE sin variantes → falla con VARIANTS_REQUIRED", async () => {
    await expect(
      ProductModel.create({
        tenantId: tenant.id,
        name: "Remera sin variantes",
        price: 5000,
        type: "VARIANTE",
      })
    ).rejects.toMatchObject({ code: "VARIANTS_REQUIRED" });
  });
});
