import { describe, it, expect, beforeAll, afterAll } from "vitest";
import prisma from "../lib/prisma.js";
import { getProductPrice } from "../helpers/price.js";
import { ProductModel } from "../services/productos.js";
import { createProduct } from "../schemas/product.schema.js";
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
  it("COMBO → retorna el precio fijo del producto, no el de la variante", () => {
    const variant = { price: 999 };
    const product = { type: "COMBO", price: 2000 };

    const price = getProductPrice(variant, product);
    expect(price).toBe(2000);
  });

  it("COMBO sin precio → retorna null", () => {
    const product = { type: "COMBO", price: null };

    const price = getProductPrice(null, product);
    expect(price).toBeNull();
  });

  it("PRODUCTO → retorna el precio de la variante", () => {
    const variant = { price: 5000 };
    const product = { type: "PRODUCTO" };

    const price = getProductPrice(variant, product);
    expect(price).toBe(5000);
  });

  it("PRODUCTO sin variante resuelta → retorna null (sin fallback a nivel producto)", () => {
    const product = { type: "PRODUCTO" };

    const price = getProductPrice(null, product);
    expect(price).toBeNull();
  });

  it("variante con precio 0 es válida → retorna 0", () => {
    const variant = { price: 0 };
    const product = { type: "PRODUCTO" };

    const price = getProductPrice(variant, product);
    expect(price).toBe(0);
  });
});

describe("Producto COMBO — precio fijo en Product", () => {
  it("crear combo con precio", async () => {
    const product = await prisma.product.create({
      data: {
        tenantId: tenant.id,
        name: "Combo test",
        price: 3500,
        type: "COMBO",
        comboMinItems: 1,
        comboMaxItems: 2,
      },
    });

    expect(product.price).toBe(3500);
    expect(product.id).toBeDefined();
  });

  it("actualizar precio del combo", async () => {
    const product = await prisma.product.create({
      data: {
        tenantId: tenant.id,
        name: "Combo actualizable",
        price: 1000,
        type: "COMBO",
        comboMinItems: 1,
        comboMaxItems: 2,
      },
    });

    const updated = await prisma.product.update({
      where: { id: product.id },
      data: { price: 2500 },
    });

    expect(updated.price).toBe(2500);
  });

  it("obtener combo incluye precio", async () => {
    const product = await prisma.product.create({
      data: {
        tenantId: tenant.id,
        name: "Combo consulta",
        price: 4200,
        type: "COMBO",
        comboMinItems: 1,
        comboMaxItems: 2,
      },
    });

    const fetched = await prisma.product.findUnique({
      where: { id: product.id },
    });

    expect(fetched.price).toBe(4200);
  });

  it("un producto PRODUCTO no tiene price a nivel Product — vive en la variante", async () => {
    const product = await prisma.product.create({
      data: {
        tenantId: tenant.id,
        name: "Producto simple",
        type: "PRODUCTO",
        variants: {
          create: [
            {
              tenantId: tenant.id,
              price: 3500,
              stock: 10,
              sku: "TEST-PROD-PRICE",
              isDefault: true,
            },
          ],
        },
      },
      include: { variants: true },
    });

    expect(product.price).toBeNull();
    expect(product.variants[0].price).toBe(3500);
  });
});

describe("ProductModel.create — reglas por tipo", () => {
  it("crear PRODUCTO con variantes → la primera queda marcada isDefault", async () => {
    const product = await ProductModel.create({
      tenantId: tenant.id,
      name: "Torta de chocolate",
      description: "Torta entera",
      type: "PRODUCTO",
      variants: [{ price: 8000, stock: 5 }],
    });

    expect(product.type).toBe("PRODUCTO");
    expect(product.variants).toHaveLength(1);
    expect(product.variants[0].isDefault).toBe(true);
    expect(product.variants[0].stock).toBe(5);
    expect(product.variants[0].price).toBe(8000);
  });

  it("crear PRODUCTO sin variantes → queda en estado transitorio (alta en 2 pasos)", async () => {
    const product = await ProductModel.create({
      tenantId: tenant.id,
      name: "Producto sin variante todavía",
      type: "PRODUCTO",
    });

    expect(product.type).toBe("PRODUCTO");
    expect(product.variants).toHaveLength(0);
  });

  it("crear COMBO sin price → falla con PRICE_REQUIRED", async () => {
    await expect(
      ProductModel.create({
        tenantId: tenant.id,
        name: "Combo sin precio",
        type: "COMBO",
        comboMinItems: 1,
        comboMaxItems: 2,
      })
    ).rejects.toMatchObject({ code: "PRICE_REQUIRED" });
  });

  it("crear COMBO con variants → falla con VARIANTS_NOT_ALLOWED", async () => {
    await expect(
      ProductModel.create({
        tenantId: tenant.id,
        name: "Combo con variantes de más",
        type: "COMBO",
        price: 8000,
        comboMinItems: 1,
        comboMaxItems: 2,
        variants: [{ attributes: { color: "#fff" }, stock: 1, price: 100 }],
      })
    ).rejects.toMatchObject({ code: "VARIANTS_NOT_ALLOWED" });
  });

  it("crear COMBO sin comboMinItems/comboMaxItems → falla con COMBO_RANGE_REQUIRED", async () => {
    await expect(
      ProductModel.create({
        tenantId: tenant.id,
        name: "Combo sin rango",
        type: "COMBO",
        price: 8000,
      })
    ).rejects.toMatchObject({ code: "COMBO_RANGE_REQUIRED" });
  });

  it("crear PRODUCTO con price/stock sueltos → arma la variante default sin variants[]", async () => {
    const product = await ProductModel.create({
      tenantId: tenant.id,
      name: "Servilletero",
      type: "PRODUCTO",
      price: 1200,
      stock: 5,
    });

    expect(product.type).toBe("PRODUCTO");
    expect(product.variants).toHaveLength(1);
    expect(product.variants[0].isDefault).toBe(true);
    expect(product.variants[0].price).toBe(1200);
    expect(product.variants[0].stock).toBe(5);
    expect(product.variants[0].sku).toBeTruthy();
  });
});

describe("ProductModel.getAll — filtro por type", () => {
  it("type=COMBO → solo devuelve combos", async () => {
    await ProductModel.create({
      tenantId: tenant.id,
      name: "Producto para filtro type",
      type: "PRODUCTO",
      price: 1000,
      stock: 3,
    });
    await ProductModel.create({
      tenantId: tenant.id,
      name: "Combo para filtro type",
      type: "COMBO",
      price: 5000,
      comboMinItems: 1,
      comboMaxItems: 2,
    });

    const combos = await ProductModel.getAll({ tenantId: tenant.id, type: "COMBO", limit: 100 });
    expect(combos.length).toBeGreaterThan(0);
    expect(combos.every((p) => p.type === "COMBO")).toBe(true);
  });

  it("type=PRODUCTO → solo devuelve productos simples", async () => {
    const productos = await ProductModel.getAll({ tenantId: tenant.id, type: "PRODUCTO", limit: 100 });
    expect(productos.length).toBeGreaterThan(0);
    expect(productos.every((p) => p.type === "PRODUCTO")).toBe(true);
  });

  it("sin type → devuelve ambos tipos", async () => {
    const todos = await ProductModel.getAll({ tenantId: tenant.id, limit: 100 });
    const types = new Set(todos.map((p) => p.type));
    expect(types.has("PRODUCTO")).toBe(true);
    expect(types.has("COMBO")).toBe(true);
  });
});

describe("createProduct schema — price/stock sueltos para PRODUCTO", () => {
  const base = { name: "Producto", type: "PRODUCTO" };

  it("PRODUCTO con price+stock → válido", () => {
    const result = createProduct.safeParse({ ...base, price: 1200, stock: 5 });
    expect(result.success).toBe(true);
  });

  it("PRODUCTO con price+stock+variants no vacío → inválido (mutuamente excluyente)", () => {
    const result = createProduct.safeParse({
      ...base,
      price: 1200,
      stock: 5,
      variants: [{ price: 1000, stock: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it("PRODUCTO con price sin stock → inválido", () => {
    const result = createProduct.safeParse({ ...base, price: 1200 });
    expect(result.success).toBe(false);
  });

  it("PRODUCTO con stock sin price → inválido", () => {
    const result = createProduct.safeParse({ ...base, stock: 5 });
    expect(result.success).toBe(false);
  });

  it("COMBO con stock → inválido (stock no aplica a combos)", () => {
    const result = createProduct.safeParse({
      name: "Combo",
      type: "COMBO",
      price: 8000,
      comboMinItems: 1,
      comboMaxItems: 2,
      stock: 5,
    });
    expect(result.success).toBe(false);
  });

  it("PRODUCTO sin price/stock/variants → válido (alta en 2 pasos)", () => {
    const result = createProduct.safeParse(base);
    expect(result.success).toBe(true);
  });
});
