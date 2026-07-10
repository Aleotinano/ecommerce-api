import { describe, it, expect, beforeAll, afterAll } from "vitest";
import prisma from "../lib/prisma.js";
import { ProductModel } from "../services/productos.js";
import { VariantModel } from "../services/variants.js";
import { CartModel } from "../services/cart.js";
import { seedTenants } from "./helpers.js";

let acme;
let customer;

beforeAll(async () => {
  ({ acme } = await seedTenants());
  customer = acme.users.find((u) => u.role === "CUSTOMER");
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Variante default: promoción automática", () => {
  it("al borrar la variante default con otra viva, promueve la de menor id", async () => {
    const product = await ProductModel.create({
      tenantId: acme.id,
      name: "Remera multicolor",
      type: "PRODUCTO",
      variants: [{ color: "#000000", stock: 5, price: 1000 }],
    });
    const defaultVariant = product.variants[0];

    const second = await VariantModel.createVariant({
      tenantId: acme.id,
      productId: product.id,
      color: "#FFFFFF",
      stock: 5,
      price: 1000,
    });
    expect(second.isDefault).toBe(false);

    await VariantModel.deleteVariant({
      tenantId: acme.id,
      productId: product.id,
      variantId: defaultVariant.id,
    });

    const promoted = await prisma.productVariant.findUnique({ where: { id: second.id } });
    expect(promoted.isDefault).toBe(true);
  });

  it("al desactivar la variante default con otra activa, promueve la otra", async () => {
    const product = await ProductModel.create({
      tenantId: acme.id,
      name: "Buzo dos colores",
      type: "PRODUCTO",
      variants: [{ color: "#111111", stock: 5, price: 2000 }],
    });
    const first = product.variants[0];
    const second = await VariantModel.createVariant({
      tenantId: acme.id,
      productId: product.id,
      color: "#222222",
      stock: 5,
      price: 2000,
    });

    await VariantModel.editVariant(
      { tenantId: acme.id, productId: product.id, variantId: first.id },
      { isActive: false }
    );

    const firstAfter = await prisma.productVariant.findUnique({ where: { id: first.id } });
    const secondAfter = await prisma.productVariant.findUnique({ where: { id: second.id } });
    expect(firstAfter.isDefault).toBe(false);
    expect(secondAfter.isDefault).toBe(true);
  });
});

describe("CartModel.add sin variantId resuelve la variante default", () => {
  it("agrega la default cuando no se especifica variante", async () => {
    const product = await ProductModel.create({
      tenantId: acme.id,
      name: "Gorra simple",
      type: "PRODUCTO",
      variants: [{ stock: 10, price: 5000 }],
    });

    const item = await CartModel.add({
      tenantId: acme.id,
      id: customer.id,
      productId: product.id,
    });
    expect(item.variantId).toBe(product.variants[0].id);

    await CartModel.remove({ tenantId: acme.id, id: customer.id, productId: product.id });
  });

  it("producto sin ninguna variante todavía → VARIANT_REQUIRED", async () => {
    const product = await ProductModel.create({
      tenantId: acme.id,
      name: "Producto recién creado (alta en 2 pasos)",
      type: "PRODUCTO",
    });

    await expect(
      CartModel.add({ tenantId: acme.id, id: customer.id, productId: product.id })
    ).rejects.toMatchObject({ code: "VARIANT_REQUIRED" });
  });
});

describe("Producto PRODUCTO con 0 variantes no rompe listados ni stats", () => {
  it("aparece en getAll y getStats sin crashear", async () => {
    const product = await ProductModel.create({
      tenantId: acme.id,
      name: "Producto en alta (paso 1, sin variante)",
      type: "PRODUCTO",
    });

    const list = await ProductModel.getAll({
      tenantId: acme.id,
      includeInactive: true,
      limit: 50,
      offset: 0,
    });
    expect(list.some((p) => p.id === product.id)).toBe(true);

    const stats = await ProductModel.getStats({ tenantId: acme.id });
    expect(stats.total).toBeGreaterThan(0);
  });
});

describe("Transición COMBO <-> PRODUCTO en ProductModel.edit", () => {
  it("PRODUCTO -> COMBO desactiva la variante (conserva isDefault); COMBO -> PRODUCTO la reactiva", async () => {
    const product = await ProductModel.create({
      tenantId: acme.id,
      name: "Torta que se vuelve combo",
      type: "PRODUCTO",
      variants: [{ stock: 5, price: 3000 }],
    });
    const variantId = product.variants[0].id;

    const edited = await ProductModel.edit(
      { tenantId: acme.id, id: product.id },
      { type: "COMBO", price: 5000, comboMinItems: 1, comboMaxItems: 2 }
    );
    expect(edited.type).toBe("COMBO");
    expect(edited.price).toBe(5000);

    const variantAfterCombo = await prisma.productVariant.findUnique({
      where: { id: variantId },
    });
    expect(variantAfterCombo.isActive).toBe(false);
    // Se preserva para poder reactivarla si el producto vuelve a PRODUCTO.
    expect(variantAfterCombo.isDefault).toBe(true);

    const reverted = await ProductModel.edit(
      { tenantId: acme.id, id: product.id },
      { type: "PRODUCTO" }
    );
    expect(reverted.type).toBe("PRODUCTO");
    expect(reverted.price).toBeNull();

    const variantAfterProducto = await prisma.productVariant.findUnique({
      where: { id: variantId },
    });
    expect(variantAfterProducto.isActive).toBe(true);
    expect(variantAfterProducto.isDefault).toBe(true);
  });
});
