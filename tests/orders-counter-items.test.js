/**
 * Órdenes cargadas por el local: `POST /orders` con `items` explícitos.
 *
 * Es la vía del mostrador del admin, que arma la venta en el momento y no tiene
 * carrito que convertir. Lo que se prueba acá es que las dos fuentes de líneas
 * conviven sin pisarse: que los ítems no tocan el carrito de nadie, que el precio lo
 * sigue poniendo el server, y que por `/store/orders` la puerta está cerrada.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import prisma from "../lib/prisma.js";
import { app } from "../app.js";
import { ProductModel } from "../services/productos.js";
import { CartModel } from "../services/cart.js";
import { OrderModel } from "../services/orders.js";
import { seedTenants, seedTenantConfig, bearerFor, cookieFor } from "./helpers.js";

let acme;
let acmeAdmin;
let acmeAdminCookie;
let acmeCustomer;
let acmeCustomerBearer;
let remeraVariant;
let remeraProductId;
let galletaA;
let galletaB;
let combo;

beforeAll(async () => {
  ({ acme } = await seedTenants());
  await seedTenantConfig(acme.id);

  acmeAdmin = acme.users.find((u) => u.role === "ADMIN");
  acmeAdminCookie = cookieFor(acmeAdmin);
  acmeCustomer = acme.users.find((u) => u.role === "CUSTOMER");
  acmeCustomerBearer = bearerFor(acmeCustomer);

  remeraVariant = await prisma.productVariant.findFirst({
    where: { tenantId: acme.id },
  });
  remeraProductId = remeraVariant.productId;

  galletaA = await ProductModel.create({
    tenantId: acme.id,
    name: "Galleta A",
    type: "PRODUCTO",
    variants: [{ price: 800, stock: 20 }],
  });
  galletaB = await ProductModel.create({
    tenantId: acme.id,
    name: "Galleta B",
    type: "PRODUCTO",
    variants: [{ price: 800, stock: 20 }],
  });
  combo = await ProductModel.create({
    tenantId: acme.id,
    name: "Combo de galletas",
    price: 3000,
    type: "COMBO",
    comboMinItems: 2,
    comboMaxItems: 4,
    comboOptions: [
      { allowedProductId: galletaA.id, minQty: 0, maxQty: 3 },
      { allowedProductId: galletaB.id, minQty: 0, maxQty: 3 },
    ],
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("OrderModel.create con items explícitos", () => {
  it("crea la orden sin carrito y con el precio del catálogo", async () => {
    const order = await OrderModel.create({
      tenantId: acme.id,
      userId: acmeAdmin.id,
      items: [{ productId: remeraProductId, variantId: remeraVariant.id, quantity: 2 }],
      fulfillmentMethod: "PICKUP",
      paymentMethod: "CASH",
      contactName: "Mostrador",
    });

    expect(order.origin).toBe("ADMIN");
    expect(order.status).toBe("NEW");
    // El precio no viajó en el body: salió de la variante.
    expect(order.total).toBe(remeraVariant.price * 2);
    expect(order.orderItems).toHaveLength(1);
    expect(order.orderItems[0].quantity).toBe(2);
    expect(order.orderItems[0].price).toBe(remeraVariant.price);
    expect(order.contactName).toBe("Mostrador");
  });

  it("no vacía el carrito de quien la carga", async () => {
    await CartModel.add({
      tenantId: acme.id,
      userId: acmeAdmin.id,
      productId: remeraProductId,
      variantId: remeraVariant.id,
    });

    await OrderModel.create({
      tenantId: acme.id,
      userId: acmeAdmin.id,
      items: [{ productId: galletaA.id, quantity: 1 }],
      fulfillmentMethod: "PICKUP",
      paymentMethod: "CASH",
    });

    const cart = await prisma.cart.findFirst({
      where: { userId: acmeAdmin.id, tenantId: acme.id },
      include: { items: true },
    });
    expect(cart.items).toHaveLength(1);
  });

  it("resuelve la variante default cuando no se manda variantId", async () => {
    const order = await OrderModel.create({
      tenantId: acme.id,
      userId: acmeAdmin.id,
      items: [{ productId: galletaA.id, quantity: 3, note: "sin azúcar" }],
      fulfillmentMethod: "PICKUP",
      paymentMethod: "CASH",
    });

    expect(order.total).toBe(2400);
    expect(order.orderItems[0].variantId).not.toBeNull();
    expect(order.orderItems[0].note).toBe("sin azúcar");
  });

  it("un combo con su selección arma las líneas hijas", async () => {
    const order = await OrderModel.create({
      tenantId: acme.id,
      userId: acmeAdmin.id,
      items: [
        {
          productId: combo.id,
          quantity: 1,
          comboSelection: [
            { productId: galletaA.id, quantity: 1 },
            { productId: galletaB.id, quantity: 1 },
          ],
        },
      ],
      fulfillmentMethod: "PICKUP",
      paymentMethod: "CASH",
    });

    // El precio fijo del combo, no la suma de los componentes.
    expect(order.total).toBe(3000);

    const items = await prisma.orderItem.findMany({
      where: { orderId: order.id },
      orderBy: { id: "asc" },
    });
    const parent = items.find((item) => item.parentItemId === null);
    const children = items.filter((item) => item.parentItemId === parent.id);
    expect(parent.productId).toBe(combo.id);
    expect(children).toHaveLength(2);
    // El cobro ya está en el padre: los hijos van en 0.
    expect(children.every((child) => child.price === 0)).toBe(true);
  });

  it("una selección de combo que no cumple el mínimo → 400", async () => {
    await expect(
      OrderModel.create({
        tenantId: acme.id,
        userId: acmeAdmin.id,
        items: [
          {
            productId: combo.id,
            quantity: 1,
            comboSelection: [{ productId: galletaA.id, quantity: 1 }],
          },
        ],
        fulfillmentMethod: "PICKUP",
        paymentMethod: "CASH",
      })
    ).rejects.toMatchObject({ code: "COMBO_SELECTION_OUT_OF_RANGE" });
  });

  it("stock insuficiente → INSUFFICIENT_STOCK, igual que desde el carrito", async () => {
    await expect(
      OrderModel.create({
        tenantId: acme.id,
        userId: acmeAdmin.id,
        items: [{ productId: galletaA.id, quantity: 999 }],
        fulfillmentMethod: "PICKUP",
        paymentMethod: "CASH",
      })
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
  });

  it("un producto de otro tenant → PRODUCT_NOT_FOUND", async () => {
    const foreign = await prisma.product.findFirst({
      where: { tenantId: { not: acme.id } },
    });

    await expect(
      OrderModel.create({
        tenantId: acme.id,
        userId: acmeAdmin.id,
        items: [{ productId: foreign.id, quantity: 1 }],
        fulfillmentMethod: "PICKUP",
        paymentMethod: "CASH",
      })
    ).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND" });
  });

  it("sin items y sin carrito → EMPTY_CART", async () => {
    await prisma.cartItem.deleteMany({});

    await expect(
      OrderModel.create({
        tenantId: acme.id,
        userId: acmeAdmin.id,
        fulfillmentMethod: "PICKUP",
        paymentMethod: "CASH",
      })
    ).rejects.toMatchObject({ code: "EMPTY_CART" });
  });
});

describe("POST /orders con items", () => {
  it("crea la orden como ADMIN", async () => {
    const res = await request(app)
      .post("/orders")
      .set("X-Tenant-Slug", "acme")
      .set("Cookie", acmeAdminCookie)
      .send({
        items: [{ productId: galletaA.id, quantity: 2 }],
        fulfillmentMethod: "PICKUP",
        paymentMethod: "CASH",
        contactName: "Cliente del mostrador",
      });

    expect(res.status).toBe(201);
    expect(res.body.order.origin).toBe("ADMIN");
    expect(res.body.order.total).toBe(1600);
  });

  it("items vacío → 400 de Zod", async () => {
    const res = await request(app)
      .post("/orders")
      .set("X-Tenant-Slug", "acme")
      .set("Cookie", acmeAdminCookie)
      .send({
        items: [],
        fulfillmentMethod: "PICKUP",
        paymentMethod: "CASH",
      });

    expect(res.status).toBe(400);
  });

  it("un precio mandado en el body se ignora", async () => {
    const res = await request(app)
      .post("/orders")
      .set("X-Tenant-Slug", "acme")
      .set("Cookie", acmeAdminCookie)
      .send({
        items: [{ productId: galletaA.id, quantity: 1, price: 1 }],
        fulfillmentMethod: "PICKUP",
        paymentMethod: "CASH",
      });

    expect(res.status).toBe(201);
    expect(res.body.order.total).toBe(800);
  });
});

describe("POST /store/orders rechaza items", () => {
  it("con carrito y items → ITEMS_NOT_ALLOWED, sin crear nada", async () => {
    await prisma.cartItem.deleteMany({});
    await CartModel.add({
      tenantId: acme.id,
      userId: acmeCustomer.id,
      productId: remeraProductId,
      variantId: remeraVariant.id,
    });

    const before = await prisma.order.count({ where: { tenantId: acme.id } });

    const res = await request(app)
      .post("/store/orders")
      .set("X-Tenant-Slug", "acme")
      .set("Authorization", acmeCustomerBearer)
      .send({
        items: [{ productId: galletaA.id, quantity: 2 }],
        fulfillmentMethod: "PICKUP",
        paymentMethod: "CASH",
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("ITEMS_NOT_ALLOWED");

    // El carrito tenía con qué: el rechazo es por los items, no por falta de
    // líneas. No quedó ninguna orden a medio hacer y el carrito sigue entero
    // —el middleware corta antes de que nadie lo toque—, así que el cliente
    // puede reintentar sin haber perdido nada.
    expect(await prisma.order.count({ where: { tenantId: acme.id } })).toBe(
      before
    );
    expect(await prisma.cartItem.count()).toBe(1);
  });

  it("el mismo pedido sin items sigue saliendo del carrito", async () => {
    await prisma.cartItem.deleteMany({});
    await CartModel.add({
      tenantId: acme.id,
      userId: acmeCustomer.id,
      productId: remeraProductId,
      variantId: remeraVariant.id,
    });

    const res = await request(app)
      .post("/store/orders")
      .set("X-Tenant-Slug", "acme")
      .set("Authorization", acmeCustomerBearer)
      .send({
        fulfillmentMethod: "PICKUP",
        paymentMethod: "CASH",
      });

    expect(res.status).toBe(201);
    expect(res.body.order.total).toBe(remeraVariant.price);
    expect(res.body.order.origin).toBe("STORE");
  });
});
