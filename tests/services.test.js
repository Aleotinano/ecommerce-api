/**
 * Servicios: `Product.type = "SERVICIO"`.
 *
 * Un servicio entra al catálogo como un producto más (categoría, precio por
 * variante), pero no tiene stock y cada línea del pedido lleva el turno: día, hora
 * y para quién. Lo que se prueba acá es ese contrato de punta a punta —alta,
 * carrito, checkout, mostrador, revisión y completar— y que un servicio no se cuela
 * por donde no corresponde (combos, stock, turnos en productos que no son servicio).
 * Ver docs/servicios/dominio/Servicios.md.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import prisma from "../lib/prisma.js";
import { app } from "../app.js";
import { ProductModel } from "../services/productos.js";
import { CartModel } from "../services/cart.js";
import { OrderModel } from "../services/orders.js";
import { createProduct, updateProduct } from "../schemas/product.schema.js";
import { serviceBooking } from "../schemas/service.schema.js";
import { resolveServiceBooking, serviceBookingOf } from "../helpers/service-booking.js";
import { seedTenants, seedTenantConfig, bearerFor, cookieFor } from "./helpers.js";

let acme;
let acmeAdmin;
let acmeAdminCookie;
let acmeCustomer;
let acmeCustomerBearer;
let remeraProductId;

// Peluquería canina: el turno es SIEMPRE para el perro, y el precio depende del tamaño.
let banio;
// Peluquería: el cliente saca turno para sí o para otro (su hijo).
let corte;
// Masaje: para quien lo contrata, no se pide destinatario.
let masaje;

// Una fecha que no vence mientras exista este test.
const FUTURE = "2099-10-05";

const storeCart = () =>
  request(app).get("/store/cart").set("X-Tenant-Slug", "acme").set("Authorization", acmeCustomerBearer);

const storeAdd = (productId, body) =>
  request(app)
    .post(`/store/cart/${productId}`)
    .set("X-Tenant-Slug", "acme")
    .set("Authorization", acmeCustomerBearer)
    .send(body);

async function clearCustomerCart() {
  await prisma.cartItem.deleteMany({ where: { cart: { userId: acmeCustomer.id } } });
}

beforeAll(async () => {
  ({ acme } = await seedTenants());
  await seedTenantConfig(acme.id);

  acmeAdmin = acme.users.find((u) => u.role === "ADMIN");
  acmeAdminCookie = cookieFor(acmeAdmin);
  acmeCustomer = acme.users.find((u) => u.role === "CUSTOMER");
  acmeCustomerBearer = bearerFor(acmeCustomer);

  const remeraVariant = await prisma.productVariant.findFirst({ where: { tenantId: acme.id } });
  remeraProductId = remeraVariant.productId;

  banio = await ProductModel.create({
    tenantId: acme.id,
    name: "Baño y corte",
    type: "SERVICIO",
    serviceRecipient: "TERCERO",
    serviceRecipientLabel: "Nombre del perro",
    variants: [
      { attributes: { talle: "chico" }, price: 12000 },
      { attributes: { talle: "grande" }, price: 18000 },
    ],
  });
  corte = await ProductModel.create({
    tenantId: acme.id,
    name: "Corte de pelo",
    type: "SERVICIO",
    serviceRecipient: "AMBOS",
    price: 8000,
  });
  masaje = await ProductModel.create({
    tenantId: acme.id,
    name: "Masaje descontracturante",
    type: "SERVICIO",
    price: 15000,
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("schemas", () => {
  it("un servicio se da de alta con price solo (sin stock)", () => {
    const parsed = createProduct.safeParse({ name: "Corte", type: "SERVICIO", price: 8000 });
    expect(parsed.success).toBe(true);
  });

  it("un servicio rechaza stock", () => {
    const parsed = createProduct.safeParse({
      name: "Corte",
      type: "SERVICIO",
      price: 8000,
      stock: 3,
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error.issues[0].path).toEqual(["stock"]);
  });

  it("las variantes de un servicio no llevan stock; las de un producto sí", () => {
    expect(
      createProduct.safeParse({ name: "Baño", type: "SERVICIO", variants: [{ price: 100 }] })
        .success
    ).toBe(true);

    const producto = createProduct.safeParse({
      name: "Remera",
      type: "PRODUCTO",
      variants: [{ price: 100 }],
    });
    expect(producto.success).toBe(false);
    expect(producto.error.issues[0].path).toEqual(["variants", 0, "stock"]);
  });

  it("serviceRecipient solo aplica a servicios", () => {
    const parsed = createProduct.safeParse({
      name: "Remera",
      type: "PRODUCTO",
      price: 100,
      stock: 1,
      serviceRecipient: "TERCERO",
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error.issues[0].path).toEqual(["serviceRecipient"]);

    expect(updateProduct.safeParse({ type: "COMBO", serviceRecipient: "AMBOS" }).success).toBe(
      false
    );
  });

  it("el turno exige fecha real y hora HH:MM", () => {
    expect(serviceBooking.safeParse({ date: FUTURE, time: "10:30" }).success).toBe(true);
    expect(serviceBooking.safeParse({ date: "2099-02-30", time: "10:30" }).success).toBe(false);
    expect(serviceBooking.safeParse({ date: "05/10/2099", time: "10:30" }).success).toBe(false);
    expect(serviceBooking.safeParse({ date: FUTURE, time: "24:00" }).success).toBe(false);
    expect(serviceBooking.safeParse({ date: FUTURE, time: "9:30" }).success).toBe(false);
  });
});

describe("resolveServiceBooking", () => {
  const tercero = { id: 1, type: "SERVICIO", serviceRecipient: "TERCERO" };

  it("guarda el día como fecha pura y lo devuelve igual", () => {
    const booking = resolveServiceBooking(tercero, {
      date: FUTURE,
      time: "10:30",
      recipientName: "  Firulais ",
    });
    expect(booking.serviceDate.toISOString()).toBe(`${FUTURE}T00:00:00.000Z`);
    expect(serviceBookingOf(booking)).toEqual({
      date: FUTURE,
      time: "10:30",
      recipientName: "Firulais",
    });
  });

  it("rechaza una fecha pasada solo si se lo piden", () => {
    const now = new Date(2026, 9, 1, 12, 0);
    const past = { date: "2026-09-30", time: "10:00", recipientName: "Firulais" };

    expect(() => resolveServiceBooking(tercero, past, { rejectPast: true, now })).toThrow(
      expect.objectContaining({ code: "SERVICE_DATE_IN_PAST" })
    );
    expect(resolveServiceBooking(tercero, past, { now }).serviceTime).toBe("10:00");
    // Hoy (día local) todavía se puede.
    expect(
      resolveServiceBooking(
        tercero,
        { ...past, date: "2026-10-01" },
        { rejectPast: true, now }
      ).serviceTime
    ).toBe("10:00");
  });

  it("un producto que no es servicio no lleva turno", () => {
    expect(resolveServiceBooking({ id: 2, type: "PRODUCTO" }, undefined)).toEqual({
      serviceDate: null,
      serviceTime: null,
      serviceRecipientName: null,
    });
    expect(() =>
      resolveServiceBooking({ id: 2, type: "PRODUCTO" }, { date: FUTURE, time: "10:00" })
    ).toThrow(expect.objectContaining({ code: "SERVICE_BOOKING_NOT_ALLOWED" }));
  });
});

describe("alta de servicios", () => {
  it("el precio vive en variantes, con stock 0 que no se usa", async () => {
    const product = await ProductModel.getByIdForManagement({ tenantId: acme.id, id: banio.id });

    expect(product.type).toBe("SERVICIO");
    expect(product.price).toBeNull();
    expect(product.serviceRecipient).toBe("TERCERO");
    expect(product.serviceRecipientLabel).toBe("Nombre del perro");
    expect(product.variants.map((v) => [v.price, v.stock])).toEqual([
      [12000, 0],
      [18000, 0],
    ]);
    expect(product.variants[0].isDefault).toBe(true);
  });

  it("sin serviceRecipient queda DIRECTO", () => {
    expect(masaje.serviceRecipient).toBe("DIRECTO");
    expect(masaje.variants).toHaveLength(1);
    expect(masaje.variants[0].price).toBe(15000);
  });

  it("un producto no acepta serviceRecipient al editarse", async () => {
    await expect(
      ProductModel.edit({ tenantId: acme.id, id: remeraProductId }, { serviceRecipient: "AMBOS" })
    ).rejects.toMatchObject({ code: "SERVICE_FIELDS_NOT_ALLOWED" });
  });

  it("PRODUCTO → SERVICIO conserva las variantes; volver limpia los campos de servicio", async () => {
    const product = await ProductModel.create({
      tenantId: acme.id,
      name: "Consulta",
      type: "PRODUCTO",
      price: 5000,
      stock: 4,
    });

    const asService = await ProductModel.edit(
      { tenantId: acme.id, id: product.id },
      { type: "SERVICIO", serviceRecipient: "AMBOS" }
    );
    expect(asService.serviceRecipient).toBe("AMBOS");
    expect(asService.variants).toHaveLength(1);
    expect(asService.variants[0].id).toBe(product.variants[0].id);

    const back = await ProductModel.edit({ tenantId: acme.id, id: product.id }, { type: "PRODUCTO" });
    expect(back.serviceRecipient).toBeNull();
    expect(back.variants[0].isActive).toBe(true);
  });

  it("agregar una variante a un servicio no pide stock; a un producto sí", async () => {
    const created = await request(app)
      .post(`/variants/${corte.id}`)
      .set("Cookie", acmeAdminCookie)
      .send({ attributes: { talle: "largo" }, price: 9500 });
    expect(created.status).toBe(201);

    const missingStock = await request(app)
      .post(`/variants/${remeraProductId}`)
      .set("Cookie", acmeAdminCookie)
      .send({ attributes: { color: "rojo" }, price: 4500 });
    expect(missingStock.status).toBe(400);
    expect(missingStock.body.error.code).toBe("STOCK_REQUIRED");
  });

  it("un servicio no puede ser parte de un combo", async () => {
    await expect(
      ProductModel.create({
        tenantId: acme.id,
        name: "Combo imposible",
        type: "COMBO",
        price: 1000,
        comboMinItems: 1,
        comboMaxItems: 1,
        comboOptions: [{ allowedProductId: masaje.id, minQty: 0, maxQty: 1 }],
      })
    ).rejects.toMatchObject({ code: "COMBO_SERVICE_NOT_ALLOWED" });
  });

  it("?type=SERVICIO lista solo los servicios (la sección del storefront)", async () => {
    const res = await request(app)
      .get("/store/products")
      .query({ type: "SERVICIO", limit: 50 })
      .set("X-Tenant-Slug", "acme");

    expect(res.status).toBe(200);
    const products = res.body.products ?? res.body.data ?? res.body;
    const types = new Set(products.map((p) => p.type));
    expect([...types]).toEqual(["SERVICIO"]);
    expect(products.map((p) => p.name)).toEqual(
      expect.arrayContaining(["Baño y corte", "Corte de pelo", "Masaje descontracturante"])
    );
  });

  it("un servicio no cuenta como 'sin stock' en las stat cards", async () => {
    const stats = await ProductModel.getStats({ tenantId: acme.id });
    // La remera del seed es el único producto con stock que mirar, y tiene 10.
    expect(stats.outOfStock).toBe(0);
  });
});

describe("carrito", () => {
  it("agregar un servicio exige el turno", async () => {
    await clearCustomerCart();
    const res = await storeAdd(masaje.id, {});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SERVICE_BOOKING_REQUIRED");
  });

  it("TERCERO exige el nombre del destinatario, con la etiqueta del servicio", async () => {
    const res = await storeAdd(banio.id, { service: { date: FUTURE, time: "10:30" } });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SERVICE_RECIPIENT_REQUIRED");
    expect(res.body.error.message).toContain("Nombre del perro");
  });

  it("DIRECTO rechaza un destinatario", async () => {
    const res = await storeAdd(masaje.id, {
      service: { date: FUTURE, time: "10:30", recipientName: "Otra persona" },
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SERVICE_RECIPIENT_NOT_ALLOWED");
  });

  it("una fecha pasada se rechaza", async () => {
    const res = await storeAdd(masaje.id, { service: { date: "2020-01-01", time: "10:30" } });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SERVICE_DATE_IN_PAST");
  });

  it("un turno en algo que no es servicio se rechaza", async () => {
    const res = await storeAdd(remeraProductId, { service: { date: FUTURE, time: "10:30" } });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SERVICE_BOOKING_NOT_ALLOWED");
  });

  it("agrega el turno y lo devuelve en GET /cart, sin stock", async () => {
    const grande = banio.variants.find((v) => v.price === 18000);
    const res = await storeAdd(banio.id, {
      variantId: grande.id,
      service: { date: FUTURE, time: "10:30", recipientName: "Firulais" },
    });

    expect(res.status).toBe(201);
    expect(res.body.data.stockRestante).toBeNull();
    expect(res.body.data.service).toEqual({
      date: FUTURE,
      time: "10:30",
      recipientName: "Firulais",
    });

    const cart = await storeCart();
    const line = cart.body.products.find((p) => p.product.id === banio.id);
    expect(line.price).toBe(18000);
    expect(line.stock).toBeNull();
    expect(line.quantity).toBe(1);
    expect(line.service).toEqual({ date: FUTURE, time: "10:30", recipientName: "Firulais" });
  });

  it("volver a agregar el mismo servicio reemplaza el turno en vez de sumar", async () => {
    const grande = banio.variants.find((v) => v.price === 18000);
    const res = await storeAdd(banio.id, {
      variantId: grande.id,
      service: { date: FUTURE, time: "16:00", recipientName: "Firulais" },
    });

    expect(res.status).toBe(201);
    expect(res.body.data.cantidad).toBe(1);
    expect(res.body.data.service.time).toBe("16:00");
  });

  it("AMBOS: sin nombre es para quien contrata", async () => {
    const res = await storeAdd(corte.id, { service: { date: FUTURE, time: "11:00" } });

    expect(res.status).toBe(201);
    expect(res.body.data.service.recipientName).toBeNull();
  });
});

describe("pedido", () => {
  it("el checkout copia el turno a cada línea del pedido", async () => {
    await clearCustomerCart();
    await CartModel.add({
      tenantId: acme.id,
      userId: acmeCustomer.id,
      productId: banio.id,
      service: { date: FUTURE, time: "10:30", recipientName: "Firulais" },
    });
    await CartModel.add({
      tenantId: acme.id,
      userId: acmeCustomer.id,
      productId: remeraProductId,
    });

    const res = await request(app)
      .post("/store/orders")
      .set("X-Tenant-Slug", "acme")
      .set("Authorization", acmeCustomerBearer)
      .send({ fulfillmentMethod: "PICKUP", paymentMethod: "CASH" });

    expect(res.status).toBe(201);
    const lines = res.body.order.productos;
    const servicio = lines.find((l) => l.productId === banio.id);
    const remera = lines.find((l) => l.productId === remeraProductId);

    // Baño perro chico (la variante default).
    expect(servicio.precio).toBe(12000);
    expect(servicio.service).toEqual({ date: FUTURE, time: "10:30", recipientName: "Firulais" });
    expect(remera.service).toBeNull();

    // Y lo ve el cliente en el detalle.
    const detail = await request(app)
      .get(`/store/orders/${res.body.order.id}`)
      .set("X-Tenant-Slug", "acme")
      .set("Authorization", acmeCustomerBearer);
    expect(detail.status).toBe(200);
    const detailLine = (detail.body.order ?? detail.body).productos.find(
      (l) => l.productId === banio.id
    );
    expect(detailLine.service.recipientName).toBe("Firulais");
  });

  it("el mostrador carga el turno en items, y completar no toca stock", async () => {
    const order = await OrderModel.create({
      tenantId: acme.id,
      userId: acmeAdmin.id,
      items: [
        {
          productId: banio.id,
          quantity: 1,
          service: { date: FUTURE, time: "09:00", recipientName: "Luna" },
        },
      ],
      fulfillmentMethod: "PICKUP",
      paymentMethod: "CASH",
      contactName: "Mostrador",
    });

    expect(order.orderItems[0].serviceTime).toBe("09:00");
    expect(order.orderItems[0].serviceRecipientName).toBe("Luna");

    const completed = await OrderModel.updateOrderStatus({
      tenantId: acme.id,
      orderId: order.id,
      status: "COMPLETED",
      changedById: acmeAdmin.id,
    });
    expect(completed.status).toBe("COMPLETED");

    const variants = await prisma.productVariant.findMany({ where: { productId: banio.id } });
    expect(variants.every((v) => v.stock === 0)).toBe(true);
  });

  it("el mostrador sin turno para un servicio se rechaza", async () => {
    await expect(
      OrderModel.create({
        tenantId: acme.id,
        userId: acmeAdmin.id,
        items: [{ productId: masaje.id, quantity: 1 }],
        fulfillmentMethod: "PICKUP",
        paymentMethod: "CASH",
      })
    ).rejects.toMatchObject({ code: "SERVICE_BOOKING_REQUIRED" });
  });

  it("la revisión reprograma el turno, y sin `service` lo conserva", async () => {
    const order = await OrderModel.create({
      tenantId: acme.id,
      userId: acmeAdmin.id,
      origin: "STORE",
      items: [
        { productId: corte.id, quantity: 1, service: { date: FUTURE, time: "11:00" } },
        { productId: masaje.id, quantity: 1, service: { date: FUTURE, time: "12:00" } },
      ],
      fulfillmentMethod: "PICKUP",
      paymentMethod: "CASH",
      contactPhone: "2644123456",
    });
    const [corteLine, masajeLine] = order.orderItems;

    const res = await request(app)
      .post(`/orders/${order.id}/review`)
      .set("Cookie", acmeAdminCookie)
      .send({
        items: [
          {
            id: corteLine.id,
            quantity: 1,
            service: { date: "2099-10-06", time: "15:30", recipientName: "Tomi" },
          },
        ],
      });

    expect(res.status).toBe(200);
    const lines = res.body.order.productos;
    expect(lines.find((l) => l.id === corteLine.id).service).toEqual({
      date: "2099-10-06",
      time: "15:30",
      recipientName: "Tomi",
    });
    expect(lines.find((l) => l.id === masajeLine.id).service).toEqual({
      date: FUTURE,
      time: "12:00",
      recipientName: null,
    });
  });
});
