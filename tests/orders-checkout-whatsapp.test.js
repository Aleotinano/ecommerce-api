import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

const prisma = (await import("../lib/prisma.js")).default;
const { app } = await import("../app.js");
const { OrderModel } = await import("../services/orders.js");
const { CartModel } = await import("../services/cart.js");
const { normalizeWaPhone, buildOrderWhatsappMessage, buildOrderWhatsappLink } =
  await import("../lib/whatsapp-link.js");
const { seedTenants, seedTenantConfig, bearerFor } = await import("./helpers.js");

let acme, acmeVariant, acmeProductId, acmeCustomer, acmeAdminId, acmeCustomerBearer;

// Precio unitario del fixture: el total del carrito con una unidad. El desglose
// del pago mixto tiene que cerrar contra esto.
let unitPrice;

async function addToCart(quantity = 1) {
  for (let i = 0; i < quantity; i++) {
    await CartModel.add({
      tenantId: acme.id,
      userId: acmeCustomer.id,
      productId: acmeProductId,
      variantId: acmeVariant.id,
    });
  }
}

function postOrder(body) {
  return request(app)
    .post("/store/orders")
    .set("X-Tenant-Slug", "acme")
    .set("Authorization", acmeCustomerBearer)
    .send(body);
}

beforeAll(async () => {
  ({ acme } = await seedTenants());
  await seedTenantConfig(acme.id, { socialWhatsapp: "+54 9 11 5555-1234" });
  acmeVariant = await prisma.productVariant.findFirst({
    where: { tenantId: acme.id },
  });
  acmeProductId = acmeVariant.productId;
  unitPrice = acmeVariant.price;
  acmeCustomer = acme.users.find((u) => u.role === "CUSTOMER");
  acmeAdminId = acme.users.find((u) => u.role === "ADMIN").id;
  acmeCustomerBearer = bearerFor(acmeCustomer);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("pago mixto: desglose de montos", () => {
  it("los montos suman el total → 201 y se persisten", async () => {
    await addToCart();
    const res = await postOrder({
      fulfillmentMethod: "PICKUP",
      paymentMethod: "MIXED",
      cashAmount: unitPrice - 1000,
      transferAmount: 1000,
    });

    expect(res.status).toBe(201);
    expect(res.body.order.cashAmount).toBe(unitPrice - 1000);
    expect(res.body.order.transferAmount).toBe(1000);

    const persisted = await prisma.order.findUnique({
      where: { id: res.body.order.id },
    });
    expect(persisted.cashAmount).toBe(unitPrice - 1000);
    expect(persisted.transferAmount).toBe(1000);
  });

  it("los montos NO suman el total → 400 PAYMENT_AMOUNTS_MISMATCH", async () => {
    await addToCart();
    const res = await postOrder({
      fulfillmentMethod: "PICKUP",
      paymentMethod: "MIXED",
      cashAmount: 1,
      transferAmount: 1,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PAYMENT_AMOUNTS_MISMATCH");
  });

  it("MIXED sin montos → 400 (Zod)", async () => {
    await addToCart();
    const res = await postOrder({
      fulfillmentMethod: "PICKUP",
      paymentMethod: "MIXED",
    });

    expect(res.status).toBe(400);
  });

  it("MIXED con un monto en 0 → 400 (Zod)", async () => {
    await addToCart();
    const res = await postOrder({
      fulfillmentMethod: "PICKUP",
      paymentMethod: "MIXED",
      cashAmount: unitPrice,
      transferAmount: 0,
    });

    expect(res.status).toBe(400);
  });

  it("CASH con cashAmount → 400 (los montos solo aplican a MIXED)", async () => {
    await addToCart();
    const res = await postOrder({
      fulfillmentMethod: "PICKUP",
      paymentMethod: "CASH",
      cashAmount: unitPrice,
    });

    expect(res.status).toBe(400);
  });

  it("el total lo manda el server: los montos se validan contra el carrito real", async () => {
    // Dos unidades: si el desglose se validara contra un total del cliente,
    // este body (armado para una sola unidad) pasaría.
    await addToCart(2);
    const res = await postOrder({
      fulfillmentMethod: "PICKUP",
      paymentMethod: "MIXED",
      cashAmount: unitPrice / 2,
      transferAmount: unitPrice / 2,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PAYMENT_AMOUNTS_MISMATCH");

    // El carrito sobrevive al rechazo (la transacción hizo rollback).
    const cart = await CartModel.getCart({
      tenantId: acme.id,
      userId: acmeCustomer.id,
    });
    expect(cart.items?.length ?? cart.length).toBeGreaterThan(0);
    await CartModel.clear({ tenantId: acme.id, userId: acmeCustomer.id });
  });
});

describe("ubicación: addressText y/o link de Google Maps", () => {
  it("DELIVERY con solo addressMapsUrl (sin calle escrita) → 201", async () => {
    await addToCart();
    const res = await postOrder({
      fulfillmentMethod: "DELIVERY",
      addressMapsUrl: "https://maps.app.goo.gl/xYz123",
      addressDetails: "rejas grises, timbre 2B",
      paymentMethod: "CASH",
    });

    expect(res.status).toBe(201);
    expect(res.body.order.addressMapsUrl).toBe("https://maps.app.goo.gl/xYz123");
    expect(res.body.order.addressText).toBeNull();
  });

  it("DELIVERY sin addressText ni addressMapsUrl → 400", async () => {
    await addToCart();
    const res = await postOrder({
      fulfillmentMethod: "DELIVERY",
      paymentMethod: "CASH",
    });

    expect(res.status).toBe(400);
  });

  it("addressMapsUrl que no es de Google Maps → 400", async () => {
    await addToCart();
    const res = await postOrder({
      fulfillmentMethod: "DELIVERY",
      addressText: "Av. Siempre Viva 742",
      addressMapsUrl: "https://evil.example.com/maps",
      paymentMethod: "CASH",
    });

    expect(res.status).toBe(400);
  });

  it("acepta las variantes de host de Google Maps", async () => {
    const urls = [
      "https://maps.app.goo.gl/abc",
      "https://www.google.com/maps/place/Obelisco",
      "https://maps.google.com/?q=-34.6,-58.4",
    ];

    for (const addressMapsUrl of urls) {
      await addToCart();
      const res = await postOrder({
        fulfillmentMethod: "DELIVERY",
        addressMapsUrl,
        paymentMethod: "CASH",
      });
      expect(res.status, addressMapsUrl).toBe(201);
    }
  });

  it("guard ADDRESS_MISSING: alcanza con el link de Maps para producir", async () => {
    const order = await OrderModel.createDraft({
      tenantId: acme.id,
      items: [{ productId: acmeProductId, variantId: acmeVariant.id, quantity: 1 }],
    });
    await OrderModel.reviewOrder({
      tenantId: acme.id,
      orderId: order.id,
      reviewedById: acmeAdminId,
      fulfillment: {
        fulfillmentMethod: "DELIVERY",
        addressMapsUrl: "https://maps.app.goo.gl/abc",
        paymentMethod: "CASH",
      },
    });

    const updated = await OrderModel.updateOrderStatus({
      tenantId: acme.id,
      orderId: order.id,
      status: "PROCESSING",
    });
    expect(updated.status).toBe("PROCESSING");
  });
});

describe("deep-link de WhatsApp", () => {
  it("normalizeWaPhone limpia el formato del teléfono", () => {
    expect(normalizeWaPhone("+54 9 11 5555-1234")).toBe("5491155551234");
    expect(normalizeWaPhone("123")).toBeNull();
    expect(normalizeWaPhone("")).toBeNull();
    expect(normalizeWaPhone(null)).toBeNull();
    expect(normalizeWaPhone(undefined)).toBeNull();
  });

  it("repara el número del negocio cargado sin código de país", () => {
    // Este test antes esperaba "01145551234" tal cual, que es un wa.me ROTO:
    // con el 0 nacional adelante y sin país, el link existe, no da error y no
    // le llega a nadie. Justo el caso que más se ve, porque el número se ve
    // bien escrito en el panel.
    expect(normalizeWaPhone("(011) 4555-1234")).toBe("5491145551234");

    // Sin país ni 0, solo característica + abonado.
    expect(normalizeWaPhone("2646064142")).toBe("5492646064142");
  });

  it("no le agrega dígitos a un número que ya vino en internacional", () => {
    // Si el admin puso el país, sabe lo que escribió: puede ser una línea fija,
    // que no lleva el 9 de móvil. Meterle un 9 la rompería.
    expect(normalizeWaPhone("+54 11 1234-5678")).toBe("541112345678");
  });

  it("completa un número local corto con la característica del tenant", () => {
    expect(normalizeWaPhone("412-3456", { area: "264" })).toBe("5492644123456");
    // Sin característica configurada no se puede reconstruir: mejor null que
    // un número inventado con largo plausible.
    expect(normalizeWaPhone("412-3456")).toBeNull();
  });

  it("el mensaje incluye items, total, pago y ubicación", () => {
    const message = buildOrderWhatsappMessage({
      order: {
        id: 812,
        total: 42500,
        paymentMethod: "MIXED",
        cashAmount: 20000,
        transferAmount: 22500,
        fulfillmentMethod: "DELIVERY",
        addressText: "Av. Siempre Viva 742",
        addressMapsUrl: "https://maps.app.goo.gl/xYz",
        addressDetails: "rejas grises",
        orderItems: [
          {
            quantity: 2,
            price: 12000,
            product: { name: "Torta chocolate" },
            note: "sin nueces",
          },
          {
            quantity: 1,
            price: 18500,
            product: { name: "Combo Mesa Dulce" },
            childItems: [
              { quantity: 6, product: { name: "Alfajor" } },
              { quantity: 12, product: { name: "Bombón" } },
            ],
          },
        ],
      },
      config: { currency: "ARS" },
    });

    expect(message).toContain("#812");
    expect(message).toContain("2x Torta chocolate");
    expect(message).toContain("(sin nueces)");
    expect(message).toContain("6x Alfajor, 12x Bombón");
    expect(message).toContain("Av. Siempre Viva 742");
    expect(message).toContain("https://maps.app.goo.gl/xYz");
    expect(message).toContain("rejas grises");
    expect(message).toMatch(/Pago: Mixto/);
  });

  it("sin addressMapsUrl pero con coordenadas, deriva el link de Maps", () => {
    const message = buildOrderWhatsappMessage({
      order: {
        id: 1,
        total: 100,
        paymentMethod: "CASH",
        fulfillmentMethod: "DELIVERY",
        addressText: "Calle Falsa 123",
        addressLat: -34.6,
        addressLng: -58.4,
        orderItems: [],
      },
    });

    expect(message).toContain("https://maps.google.com/?q=-34.6,-58.4");
  });

  it("sin teléfono usable en TenantConfig → null", () => {
    expect(
      buildOrderWhatsappLink({
        order: { id: 1, total: 100, orderItems: [] },
        config: { socialWhatsapp: null, contactPhone: null },
      })
    ).toBeNull();
  });

  it("cae a contactPhone si no hay socialWhatsapp", () => {
    const link = buildOrderWhatsappLink({
      order: { id: 1, total: 100, orderItems: [] },
      config: { socialWhatsapp: null, contactPhone: "+541112345678" },
    });

    expect(link.phone).toBe("541112345678");
  });

  it("el 201 del checkout trae el link con el teléfono del tenant", async () => {
    await addToCart();
    const res = await postOrder({
      fulfillmentMethod: "PICKUP",
      paymentMethod: "CASH",
    });

    expect(res.status).toBe(201);
    expect(res.body.whatsapp.phone).toBe("5491155551234");
    expect(res.body.whatsapp.url).toContain("https://wa.me/5491155551234?text=");
    expect(res.body.whatsapp.message).toContain(`#${res.body.order.id}`);
    // El texto viaja url-encodeado dentro del link.
    expect(decodeURIComponent(res.body.whatsapp.url)).toContain(
      res.body.whatsapp.message
    );
  });

  it("tenant sin WhatsApp cargado → la orden se crea igual, con whatsapp null", async () => {
    await seedTenantConfig(acme.id, { socialWhatsapp: null, contactPhone: null });
    await addToCart();

    const res = await postOrder({
      fulfillmentMethod: "PICKUP",
      paymentMethod: "CASH",
    });

    expect(res.status).toBe(201);
    expect(res.body.order.id).toBeDefined();
    expect(res.body.whatsapp).toBeNull();

    await seedTenantConfig(acme.id, {
      socialWhatsapp: "+54 9 11 5555-1234",
      contactPhone: "+541112345678",
    });
  });
});

describe("órdenes STORE: revisión obligatoria antes de producir", () => {
  it("una orden del storefront nace con origin STORE y sin revisar", async () => {
    await addToCart();
    const res = await postOrder({
      fulfillmentMethod: "PICKUP",
      paymentMethod: "CASH",
    });

    expect(res.status).toBe(201);
    expect(res.body.order.origin).toBe("STORE");

    const persisted = await prisma.order.findUnique({
      where: { id: res.body.order.id },
    });
    expect(persisted.reviewedById).toBeNull();
  });

  it("sin revisar no pasa a PROCESSING; tras el review, sí", async () => {
    await addToCart();
    const res = await postOrder({
      fulfillmentMethod: "PICKUP",
      paymentMethod: "CASH",
    });
    const orderId = res.body.order.id;

    await expect(
      OrderModel.updateOrderStatus({
        tenantId: acme.id,
        orderId,
        status: "PROCESSING",
      })
    ).rejects.toMatchObject({ code: "ORDER_NOT_REVIEWED" });

    await OrderModel.reviewOrder({
      tenantId: acme.id,
      orderId,
      reviewedById: acmeAdminId,
    });

    const updated = await OrderModel.updateOrderStatus({
      tenantId: acme.id,
      orderId,
      status: "PROCESSING",
    });
    expect(updated.status).toBe("PROCESSING");
  });

  it("una orden cargada por un admin (origin ADMIN) no necesita review", async () => {
    await addToCart();
    const order = await OrderModel.create({
      tenantId: acme.id,
      userId: acmeCustomer.id,
      fulfillmentMethod: "PICKUP",
      paymentMethod: "CASH",
    });

    const updated = await OrderModel.updateOrderStatus({
      tenantId: acme.id,
      orderId: order.id,
      status: "PROCESSING",
    });
    expect(updated.status).toBe("PROCESSING");
  });

  it("cancelar no exige revisión", async () => {
    await addToCart();
    const res = await postOrder({
      fulfillmentMethod: "PICKUP",
      paymentMethod: "CASH",
    });

    const updated = await OrderModel.updateOrderStatus({
      tenantId: acme.id,
      orderId: res.body.order.id,
      status: "CANCELLED",
    });
    expect(updated.status).toBe("CANCELLED");
  });
});

describe("reviewOrder: coherencia del desglose mixto", () => {
  it("si el review cambia el total, los montos viejos ya no cierran → 400", async () => {
    await addToCart(2);
    const order = await OrderModel.create({
      tenantId: acme.id,
      userId: acmeCustomer.id,
      fulfillmentMethod: "PICKUP",
      paymentMethod: "MIXED",
      cashAmount: unitPrice,
      transferAmount: unitPrice,
    });

    // Bajar a 1 unidad deja el total en la mitad: el desglose queda desalineado.
    await expect(
      OrderModel.reviewOrder({
        tenantId: acme.id,
        orderId: order.id,
        reviewedById: acmeAdminId,
        items: [{ id: order.orderItems[0].id, quantity: 1 }],
      })
    ).rejects.toMatchObject({ code: "PAYMENT_AMOUNTS_MISMATCH" });
  });

  it("el admin corrige cantidades y montos juntos → pasa", async () => {
    await addToCart(2);
    const order = await OrderModel.create({
      tenantId: acme.id,
      userId: acmeCustomer.id,
      fulfillmentMethod: "PICKUP",
      paymentMethod: "MIXED",
      cashAmount: unitPrice,
      transferAmount: unitPrice,
    });

    const reviewed = await OrderModel.reviewOrder({
      tenantId: acme.id,
      orderId: order.id,
      reviewedById: acmeAdminId,
      items: [{ id: order.orderItems[0].id, quantity: 1 }],
      fulfillment: {
        cashAmount: unitPrice / 2,
        transferAmount: unitPrice / 2,
      },
    });

    expect(reviewed.total).toBe(unitPrice);
    expect(reviewed.cashAmount).toBe(unitPrice / 2);
  });

  it("al salir de MIXED se limpia el desglose", async () => {
    await addToCart();
    const order = await OrderModel.create({
      tenantId: acme.id,
      userId: acmeCustomer.id,
      fulfillmentMethod: "PICKUP",
      paymentMethod: "MIXED",
      cashAmount: unitPrice / 2,
      transferAmount: unitPrice / 2,
    });

    const reviewed = await OrderModel.reviewOrder({
      tenantId: acme.id,
      orderId: order.id,
      reviewedById: acmeAdminId,
      fulfillment: { paymentMethod: "CASH" },
    });

    expect(reviewed.paymentMethod).toBe("CASH");
    expect(reviewed.cashAmount).toBeNull();
    expect(reviewed.transferAmount).toBeNull();
  });
});
