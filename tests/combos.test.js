import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import prisma from "../lib/prisma.js";
import { app } from "../app.js";
import { ProductModel } from "../services/productos.js";
import { CartModel } from "../services/cart.js";
import { OrderModel } from "../services/orders.js";
import { buildToolContext } from "../services/chat/tools.js";
import { seedTenants, cookieFor } from "./helpers.js";

let acme;
let acmeAdminCookie;
let acmeCustomer;
let galletaA;
let galletaB;
let galletaC;
let galletaD;
let combo;

beforeAll(async () => {
  ({ acme } = await seedTenants());
  acmeAdminCookie = cookieFor(acme.users.find((u) => u.role === "ADMIN"));
  acmeCustomer = acme.users.find((u) => u.role === "CUSTOMER");

  galletaA = await ProductModel.create({
    tenantId: acme.id,
    name: "Galleta A",
    price: 800,
    type: "UNIDAD",
    variants: [],
    stock: 20,
  });
  galletaB = await ProductModel.create({
    tenantId: acme.id,
    name: "Galleta B",
    price: 800,
    type: "UNIDAD",
    variants: [],
    stock: 20,
  });
  galletaC = await ProductModel.create({
    tenantId: acme.id,
    name: "Galleta C (no permitida)",
    price: 800,
    type: "UNIDAD",
    variants: [],
    stock: 20,
  });
  galletaD = await ProductModel.create({
    tenantId: acme.id,
    name: "Galleta D (poco stock)",
    price: 800,
    type: "UNIDAD",
    variants: [],
    stock: 1,
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
      { allowedProductId: galletaD.id, minQty: 0 },
    ],
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("ProductModel: crear/editar combos", () => {
  it("create con type=COMBO + comboOptions persiste la whitelist", async () => {
    expect(combo.type).toBe("COMBO");
    expect(combo.comboMinItems).toBe(2);
    expect(combo.comboMaxItems).toBe(4);

    const options = await ProductModel.getComboOptions({
      tenantId: acme.id,
      id: combo.id,
    });

    expect(options.comboMinItems).toBe(2);
    expect(options.comboMaxItems).toBe(4);
    const ids = options.allowedProducts.map((p) => p.productId).sort((a, b) => a - b);
    expect(ids).toEqual([galletaA.id, galletaB.id, galletaD.id].sort((a, b) => a - b));
  });

  it("getComboOptions sobre un producto que no es combo → PRODUCT_NOT_COMBO", async () => {
    await expect(
      ProductModel.getComboOptions({ tenantId: acme.id, id: galletaA.id })
    ).rejects.toMatchObject({ code: "PRODUCT_NOT_COMBO" });
  });

  it("no permite combos anidados en la whitelist", async () => {
    await expect(
      ProductModel.create({
        tenantId: acme.id,
        name: "Combo inválido",
        price: 1000,
        type: "COMBO",
        comboMinItems: 1,
        comboMaxItems: 1,
        comboOptions: [{ allowedProductId: combo.id }],
      })
    ).rejects.toMatchObject({ code: "COMBO_NESTED_NOT_ALLOWED" });
  });

  it("edit reemplaza la whitelist completa", async () => {
    const edited = await ProductModel.edit(
      { tenantId: acme.id, id: combo.id },
      { comboOptions: [{ allowedProductId: galletaC.id, minQty: 0, maxQty: 4 }] }
    );
    expect(edited.type).toBe("COMBO");

    const options = await ProductModel.getComboOptions({
      tenantId: acme.id,
      id: combo.id,
    });
    expect(options.allowedProducts.map((p) => p.productId)).toEqual([galletaC.id]);

    // Restaura la whitelist original para el resto de los tests de este archivo.
    await ProductModel.edit(
      { tenantId: acme.id, id: combo.id },
      {
        comboOptions: [
          { allowedProductId: galletaA.id, minQty: 0, maxQty: 3 },
          { allowedProductId: galletaB.id, minQty: 0, maxQty: 3 },
          { allowedProductId: galletaD.id, minQty: 0 },
        ],
      }
    );
  });

  it("edit rechaza que un combo se permita a sí mismo", async () => {
    await expect(
      ProductModel.edit(
        { tenantId: acme.id, id: combo.id },
        { comboOptions: [{ allowedProductId: combo.id }] }
      )
    ).rejects.toMatchObject({ code: "COMBO_PRODUCT_NOT_ALLOWED" });
  });
});

describe("GET /products/:id/combo-options", () => {
  it("ADMIN puede leer la whitelist del combo", async () => {
    const res = await request(app)
      .get(`/products/${combo.id}/combo-options`)
      .set("Cookie", acmeAdminCookie);

    expect(res.status).toBe(200);
    expect(res.body.comboMinItems).toBe(2);
    expect(res.body.allowedProducts).toHaveLength(3);
  });
});

describe("POST /cart/combo/:productId", () => {
  it("selección válida dentro del whitelist y del min/max → 201", async () => {
    const res = await request(app)
      .post(`/cart/combo/${combo.id}`)
      .set("Cookie", cookieFor(acmeCustomer))
      .send({
        selection: [
          { productId: galletaA.id, quantity: 2 },
          { productId: galletaB.id, quantity: 1 },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.cantidad).toBe(1);
    expect(res.body.data.seleccion).toHaveLength(2);
  });

  it("selección por debajo del mínimo → 400 COMBO_SELECTION_OUT_OF_RANGE", async () => {
    const res = await request(app)
      .post(`/cart/combo/${combo.id}`)
      .set("Cookie", cookieFor(acmeCustomer))
      .send({ selection: [{ productId: galletaA.id, quantity: 1 }] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("COMBO_SELECTION_OUT_OF_RANGE");
  });

  it("producto fuera de la whitelist → 400 COMBO_PRODUCT_NOT_ALLOWED", async () => {
    const res = await request(app)
      .post(`/cart/combo/${combo.id}`)
      .set("Cookie", cookieFor(acmeCustomer))
      .send({
        selection: [
          { productId: galletaA.id, quantity: 1 },
          { productId: galletaC.id, quantity: 1 },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("COMBO_PRODUCT_NOT_ALLOWED");
  });

  it("excede maxQty permitido para ese producto → 400 COMBO_ITEM_QTY_OUT_OF_RANGE", async () => {
    const res = await request(app)
      .post(`/cart/combo/${combo.id}`)
      .set("Cookie", cookieFor(acmeCustomer))
      .send({ selection: [{ productId: galletaA.id, quantity: 4 }] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("COMBO_ITEM_QTY_OUT_OF_RANGE");
  });

  it("stock insuficiente de un componente → 409 INSUFFICIENT_STOCK", async () => {
    // galletaD tiene stock=1 y sin maxQty propio; pedir 2 respeta comboMinItems/
    // comboMaxItems (2-4) pero excede el stock real del componente.
    const res = await request(app)
      .post(`/cart/combo/${combo.id}`)
      .set("Cookie", cookieFor(acmeCustomer))
      .send({ selection: [{ productId: galletaD.id, quantity: 2 }] });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INSUFFICIENT_STOCK");
  });
});

describe("Orden con combo: precio fijo, stock sobre componentes", () => {
  it("total = precio fijo del combo (no suma de partes) y arma childItems", async () => {
    // El customer puede tener una línea de combo residual de los tests de
    // carrito de arriba; se limpia para que `quantity` (cantidad de combos
    // comprados) parta de 0 y las aserciones de total/quantity sean exactas.
    await CartModel.clear({ tenantId: acme.id, id: acmeCustomer.id }).catch(() => {});

    await CartModel.addCombo({
      tenantId: acme.id,
      id: acmeCustomer.id,
      comboProductId: combo.id,
      selection: [
        { productId: galletaA.id, quantity: 2 },
        { productId: galletaB.id, quantity: 1 },
      ],
    });

    const order = await OrderModel.create({ tenantId: acme.id, userId: acmeCustomer.id });

    expect(order.total).toBe(3000);
    expect(order.orderItems).toHaveLength(1);

    const parent = order.orderItems[0];
    expect(parent.productId).toBe(combo.id);
    expect(parent.variantId).toBeNull();
    expect(parent.price).toBe(3000);
    expect(parent.childItems).toHaveLength(2);
    expect(parent.childItems.every((c) => c.price === 0)).toBe(true);

    const childA = parent.childItems.find((c) => c.productId === galletaA.id);
    const childB = parent.childItems.find((c) => c.productId === galletaB.id);
    expect(childA.quantity).toBe(2);
    expect(childB.quantity).toBe(1);
  });

  it("al completar la orden descuenta stock de los componentes, no del combo", async () => {
    await CartModel.addCombo({
      tenantId: acme.id,
      id: acmeCustomer.id,
      comboProductId: combo.id,
      selection: [{ productId: galletaA.id, quantity: 2 }],
    });
    const order = await OrderModel.create({ tenantId: acme.id, userId: acmeCustomer.id });

    const stockBeforeA = (
      await prisma.product.findUnique({ where: { id: galletaA.id } })
    ).stock;

    await OrderModel.updateOrderStatus({
      tenantId: acme.id,
      orderId: order.id,
      status: "COMPLETED",
    });

    const stockAfterA = (
      await prisma.product.findUnique({ where: { id: galletaA.id } })
    ).stock;
    const comboAfter = await prisma.product.findUnique({ where: { id: combo.id } });

    expect(stockAfterA).toBe(stockBeforeA - 2);
    expect(comboAfter.stock).toBeNull();
  });
});

describe("Bot de WhatsApp: combos rechazados con mensaje amigable", () => {
  it("createDraftOrder sobre un producto combo devuelve error, no crea la orden", async () => {
    const { executeTool } = buildToolContext({
      tenantId: acme.id,
      user: null,
      config: {},
      channel: { kind: "whatsapp", waId: "5491100000000", history: [], message: "quiero el combo" },
    });

    const ordersBefore = await prisma.order.count({ where: { tenantId: acme.id } });

    const result = await executeTool("createDraftOrder", {
      items: [{ productId: combo.id, quantity: 1 }],
    });

    expect(result.error).toBeDefined();
    expect(result.created).toBeUndefined();

    const ordersAfter = await prisma.order.count({ where: { tenantId: acme.id } });
    expect(ordersAfter).toBe(ordersBefore);
  });
});
