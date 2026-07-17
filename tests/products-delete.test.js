import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Cloudinary mockeado (sin red): ProductModel.delete intenta limpiar los
// assets de las SuggestionImage del producto antes de borrarlo.
const { destroyMock } = vi.hoisted(() => ({
  destroyMock: vi.fn(),
}));
vi.mock("../lib/cloudinary.js", () => ({
  default: { uploader: { upload: vi.fn(), destroy: destroyMock } },
}));

const prisma = (await import("../lib/prisma.js")).default;
const { ProductModel } = await import("../services/productos.js");
const { seedTenants } = await import("./helpers.js");

let acme;

beforeAll(async () => {
  const tenants = await seedTenants();
  acme = tenants.acme;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("ProductModel.delete — integridad referencial", () => {
  it("borra un producto con ContentSuggestion + SuggestionImage (cascade) y limpia Cloudinary", async () => {
    destroyMock.mockReset().mockResolvedValue({ result: "ok" });

    const product = await prisma.product.create({
      data: {
        tenantId: acme.id,
        name: "Con sugerencia",
        type: "PRODUCTO",
        variants: {
          create: [{ tenantId: acme.id, price: 100, stock: 5, sku: "DEL-SUG", isDefault: true }],
        },
      },
    });

    const suggestion = await prisma.contentSuggestion.create({
      data: {
        tenantId: acme.id,
        productId: product.id,
        angle: "NEW_ARRIVAL",
        date: new Date(),
      },
    });

    await prisma.suggestionImage.create({
      data: {
        suggestionId: suggestion.id,
        tenantId: acme.id,
        imageUrl: "https://cdn/img.png",
        imagePublicId: "content-suggestions/img1",
        prompt: "prompt de prueba",
      },
    });

    const result = await ProductModel.delete({ tenantId: acme.id, id: product.id });

    expect(result.id).toBe(product.id);
    expect(destroyMock).toHaveBeenCalledWith(
      "content-suggestions/img1",
      expect.objectContaining({ resource_type: "image" })
    );

    const remainingSuggestions = await prisma.contentSuggestion.findMany({
      where: { productId: product.id },
    });
    expect(remainingSuggestions).toHaveLength(0);
  });

  it("borra un producto presente en un carrito (CartItem cascade)", async () => {
    const product = await prisma.product.create({
      data: {
        tenantId: acme.id,
        name: "En carrito",
        type: "PRODUCTO",
        variants: {
          create: [{ tenantId: acme.id, price: 200, stock: 5, sku: "DEL-CART", isDefault: true }],
        },
      },
      include: { variants: true },
    });

    const customer = acme.users.find((u) => u.role === "CUSTOMER");
    const cart = await prisma.cart.upsert({
      where: { userId: customer.id },
      update: {},
      create: { tenantId: acme.id, userId: customer.id },
    });
    await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        productId: product.id,
        variantId: product.variants[0].id,
        quantity: 1,
      },
    });

    const result = await ProductModel.delete({ tenantId: acme.id, id: product.id });

    expect(result.id).toBe(product.id);

    const remainingCartItems = await prisma.cartItem.findMany({
      where: { productId: product.id },
    });
    expect(remainingCartItems).toHaveLength(0);
  });

  it("rechaza el borrado de un producto con pedidos asociados (409 PRODUCT_HAS_ORDERS)", async () => {
    const product = await prisma.product.create({
      data: {
        tenantId: acme.id,
        name: "Con pedido",
        type: "PRODUCTO",
        variants: {
          create: [{ tenantId: acme.id, price: 300, stock: 5, sku: "DEL-ORD", isDefault: true }],
        },
      },
      include: { variants: true },
    });

    const customer = acme.users.find((u) => u.role === "CUSTOMER");
    await prisma.order.create({
      data: {
        tenantId: acme.id,
        userId: customer.id,
        status: "COMPLETED",
        total: 300,
        paymentStatus: "PENDING",
        orderItems: {
          create: [{ productId: product.id, variantId: product.variants[0].id, quantity: 1, price: 300 }],
        },
      },
    });

    await expect(
      ProductModel.delete({ tenantId: acme.id, id: product.id })
    ).rejects.toMatchObject({ statusCode: 409, code: "PRODUCT_HAS_ORDERS" });

    const stillExists = await prisma.product.findUnique({ where: { id: product.id } });
    expect(stillExists).not.toBeNull();
  });
});
