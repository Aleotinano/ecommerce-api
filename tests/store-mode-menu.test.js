import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";
import request from "supertest";

const prisma = (await import("../lib/prisma.js")).default;
const { app } = await import("../app.js");
const { OrderModel } = await import("../services/orders.js");
const { CartModel } = await import("../services/cart.js");
const { seedTenants, seedTenantConfig, loginAs } = await import("./helpers.js");

/**
 * `storeMode: MENU` — la tienda que se LEE y no se compra (restó, cafetería).
 *
 * Hasta que existió este guard, el modo carta lo apagaba **solo el storefront** no
 * montando el carrito: cualquiera que escribiera `/checkout` en la barra de
 * direcciones —o un `curl`— compraba igual en un tenant que no vende.
 *
 * Hay dos llaves y las dos se prueban acá: el middleware de ruta
 * (`middleware/storeMode.js`) y el chequeo de `OrderModel.create`, que es el que
 * cubre a la próxima ruta que monte ese service sin acordarse del middleware.
 *
 * Lo que NO bloquea es tan importante como lo que bloquea: en modo carta el pedido
 * se cierra por fuera (WhatsApp, mostrador), así que el backoffice sigue vendiendo.
 */

let acme;
let variant;
let customerId;
let adminCookie;

beforeAll(async () => {
  ({ acme } = await seedTenants());
  await seedTenantConfig(acme.id);

  variant = await prisma.productVariant.findFirst({ where: { tenantId: acme.id } });
  customerId = acme.users.find((u) => u.role === "CUSTOMER").id;

  ({ cookie: adminCookie } = await loginAs(app, { email: "admin@acme.com" }));
});

afterEach(async () => {
  await setMode("SHOP");
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** Deja al tenant en un modo concreto. */
function setMode(storeMode) {
  return prisma.tenantConfig.update({
    where: { tenantId: acme.id },
    data: { storeMode },
  });
}

const store = (method, path) =>
  request(app)[method](path).set("X-Tenant-Slug", "acme");

/** Un carrito con algo adentro, para no chocar antes con EMPTY_CART. */
function fillCart() {
  return CartModel.add({
    tenantId: acme.id,
    userId: customerId,
    productId: variant.productId,
    variantId: variant.id,
  });
}

const CHECKOUT = {
  fulfillmentMethod: "PICKUP",
  paymentMethod: "CASH",
  contactName: "Ana",
  contactPhone: "2645551234",
};

describe("storeMode MENU: el storefront no vende", () => {
  beforeEach(async () => {
    await setMode("MENU");
  });

  it("el checkout responde 404 STORE_MODE_MENU", async () => {
    const res = await store("post", "/store/orders").send(CHECKOUT);

    // 404 y no 403: para este tenant el checkout no existe, no es que falten
    // permisos. El código es lo que lo distingue de un 404 de ruta.
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("STORE_MODE_MENU");
  });

  it("el carrito tampoco existe: ni agregar ni leer", async () => {
    const add = await store("post", `/store/cart/${variant.productId}`).send({
      variantId: variant.id,
    });
    expect(add.status).toBe(404);
    expect(add.body.error.code).toBe("STORE_MODE_MENU");

    // Un carrito que acepta items y después no deja confirmar es una trampa: el
    // cliente se entera al final.
    const get = await store("get", "/store/cart");
    expect(get.status).toBe(404);
    expect(get.body.error.code).toBe("STORE_MODE_MENU");
  });

  it("la carta se sigue leyendo, que es TODO lo que hace un tenant así", async () => {
    // `/store/products` devuelve el array pelado, no un objeto con `products`.
    const productos = await store("get", "/store/products");
    expect(productos.status).toBe(200);
    expect(productos.body.length).toBeGreaterThan(0);

    const arbol = await store("get", "/store/categories/tree");
    expect(arbol.status).toBe(200);
  });

  it("el mostrador del admin sigue vendiendo", async () => {
    // En modo carta el pedido se cierra por fuera. Que el local no pueda registrar
    // la venta que hizo por WhatsApp sería romperle la caja, no protegerlo.
    const res = await request(app)
      .post("/orders")
      .set("X-Tenant-Slug", "acme")
      .set("Cookie", adminCookie)
      .send({
        items: [{ productId: variant.productId, variantId: variant.id, quantity: 1 }],
        ...CHECKOUT,
      });

    expect(res.status).toBe(201);
    expect(res.body.order.origin).toBe("ADMIN");
  });

  it("la segunda llave: el service rechaza un pedido STORE sin pasar por la ruta", async () => {
    await fillCart();

    await expect(
      OrderModel.create({
        tenantId: acme.id,
        userId: customerId,
        origin: "STORE",
        ...CHECKOUT,
      })
    ).rejects.toMatchObject({ code: "STORE_MODE_MENU", statusCode: 404 });
  });

  it("pero no toca los borradores del bot", async () => {
    const draft = await OrderModel.createDraft({
      tenantId: acme.id,
      items: [{ productId: variant.productId, variantId: variant.id, quantity: 1 }],
      contactPhone: "5492645551234",
      contactName: "Cliente de WhatsApp",
    });

    expect(draft.origin).toBe("BOT");
  });
});

describe("storeMode SHOP: nada cambia", () => {
  it("el carrito y el checkout siguen funcionando", async () => {
    await setMode("SHOP");
    await fillCart();

    const order = await OrderModel.create({
      tenantId: acme.id,
      userId: customerId,
      origin: "STORE",
      ...CHECKOUT,
    });

    expect(order.id).toBeDefined();
    expect(order.origin).toBe("STORE");
  });

  it("un tenant sin fila de config vende igual", async () => {
    // `SHOP` es el default de la columna, pero la fila puede no existir: un tenant a
    // medio configurar no puede quedar sin vender por eso.
    await prisma.tenantConfig.deleteMany({ where: { tenantId: acme.id } });

    const res = await store("get", "/store/cart");
    expect(res.status).toBe(200);

    await seedTenantConfig(acme.id);
  });
});
