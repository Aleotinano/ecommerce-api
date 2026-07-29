import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

const prisma = (await import("../lib/prisma.js")).default;
const { app } = await import("../app.js");
const { OrderModel } = await import("../services/orders.js");
const { CartModel } = await import("../services/cart.js");
const { seedTenants, seedTenantConfig, loginAs } = await import("./helpers.js");

// Qué métodos acepta cada tenant. Los enums de `schemas/order.schema.js` son los
// valores posibles del sistema; estas listas son los HABILITADOS para el tenant, y
// se setean desde un perfil (`services/tenant-profiles.js`). La validación no puede
// vivir en Zod porque Zod no conoce el tenant.

let acme;
let variant;
let customerId;
let cookie;

beforeAll(async () => {
  ({ acme } = await seedTenants());
  await seedTenantConfig(acme.id);

  variant = await prisma.productVariant.findFirst({ where: { tenantId: acme.id } });
  customerId = acme.users.find((u) => u.role === "CUSTOMER").id;

  ({ cookie } = await loginAs(app, { email: "admin@acme.com" }));
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** Deja al tenant con un flujo de venta concreto. */
function setFlow(overrides) {
  return prisma.tenantConfig.update({
    where: { tenantId: acme.id },
    data: overrides,
  });
}

async function checkout(body) {
  await CartModel.add({
    tenantId: acme.id,
    userId: customerId,
    productId: variant.productId,
    variantId: variant.id,
  });

  return OrderModel.create({
    tenantId: acme.id,
    userId: customerId,
    origin: "STORE",
    contactName: "Ana",
    contactPhone: "2645551234",
    ...body,
  });
}

/** Corre `fn` esperando que falle, y devuelve el error. */
async function failsWith(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error("debería haber lanzado");
}

describe("métodos habilitados por tenant", () => {
  it("rechaza el método de pago que el tenant no acepta", async () => {
    await setFlow({
      paymentMethodsEnabled: ["CASH"],
      fulfillmentMethodsEnabled: ["DELIVERY", "PICKUP"],
    });

    const error = await failsWith(() =>
      checkout({ fulfillmentMethod: "PICKUP", paymentMethod: "TRANSFER" })
    );

    expect(error.code).toBe("PAYMENT_METHOD_NOT_ENABLED");
    expect(error.statusCode).toBe(400);
    // El panel necesita poder decir qué SÍ se puede, no solo que esto no.
    expect(error.details).toEqual({ pedido: "TRANSFER", habilitados: ["CASH"] });
  });

  it("acepta el que sí está habilitado", async () => {
    await setFlow({ paymentMethodsEnabled: ["CASH"] });

    const order = await checkout({
      fulfillmentMethod: "PICKUP",
      paymentMethod: "CASH",
    });

    expect(order.paymentMethod).toBe("CASH");
  });

  it("rechaza la forma de entrega que el tenant no ofrece", async () => {
    await setFlow({
      paymentMethodsEnabled: ["CASH"],
      fulfillmentMethodsEnabled: ["DELIVERY"],
    });

    const error = await failsWith(() =>
      checkout({ fulfillmentMethod: "PICKUP", paymentMethod: "CASH" })
    );

    expect(error.code).toBe("FULFILLMENT_METHOD_NOT_ENABLED");
    expect(error.details).toEqual({ pedido: "PICKUP", habilitados: ["DELIVERY"] });
  });

  it("una lista vacía significa 'todo habilitado', no 'nada'", async () => {
    // Es el comportamiento previo a que estas columnas existieran: una config a
    // medio migrar no puede dejar al tenant sin poder vender.
    await setFlow({ paymentMethodsEnabled: [], fulfillmentMethodsEnabled: [] });

    const order = await checkout({
      fulfillmentMethod: "PICKUP",
      paymentMethod: "TRANSFER",
    });

    expect(order.paymentMethod).toBe("TRANSFER");
  });

  it("no toca el carrito cuando rechaza: el checkout se puede reintentar", async () => {
    await setFlow({
      paymentMethodsEnabled: ["CASH"],
      fulfillmentMethodsEnabled: ["DELIVERY", "PICKUP"],
    });

    await failsWith(() =>
      checkout({ fulfillmentMethod: "PICKUP", paymentMethod: "MIXED", cashAmount: 1, transferAmount: 1 })
    );

    // El guard corre ANTES de la transacción, así que el carrito sigue cargado y
    // el cliente puede corregir el método sin volver a armar el pedido.
    const cart = await CartModel.getCart({ tenantId: acme.id, userId: customerId });
    expect(cart.items.length).toBeGreaterThan(0);

    const order = await OrderModel.create({
      tenantId: acme.id,
      userId: customerId,
      fulfillmentMethod: "PICKUP",
      paymentMethod: "CASH",
    });
    expect(order.paymentMethod).toBe("CASH");
  });
});

describe("el review usa el mismo guard", () => {
  it("no puede pasar una orden del bot a un método deshabilitado", async () => {
    await setFlow({
      paymentMethodsEnabled: ["CASH"],
      fulfillmentMethodsEnabled: ["DELIVERY", "PICKUP"],
    });

    // Las órdenes del bot nacen sin método: el review es donde se elige, así que
    // es la otra puerta que hay que cuidar.
    const draft = await OrderModel.createDraft({
      tenantId: acme.id,
      items: [{ productId: variant.productId, variantId: variant.id, quantity: 1 }],
    });

    const res = await request(app)
      .post(`/orders/${draft.id}/review`)
      .set("Cookie", cookie)
      .send({ fulfillmentMethod: "PICKUP", paymentMethod: "TRANSFER" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PAYMENT_METHOD_NOT_ENABLED");
  });
});

describe("la seña del tenant también aplica al checkout web", () => {
  it("una orden creada desde el carrito nace con la seña pactada", async () => {
    // Antes, `create` no leía la config: la orden salía con requiresDeposit false
    // aunque el tenant cobrara seña, y esquivaba el guard DEPOSIT_NOT_CONFIRMED.
    await setFlow({
      paymentMethodsEnabled: ["CASH", "TRANSFER", "MIXED"],
      fulfillmentMethodsEnabled: ["DELIVERY", "PICKUP"],
      depositEnabled: true,
      depositPercentage: 40,
    });

    const order = await checkout({
      fulfillmentMethod: "PICKUP",
      paymentMethod: "TRANSFER",
    });

    expect(order.requiresDeposit).toBe(true);
    expect(order.depositAmount).toBe(Math.round(order.total * 0.4 * 100) / 100);
  });

  it("sin seña en el tenant, la orden no la exige", async () => {
    await setFlow({ depositEnabled: false });

    const order = await checkout({
      fulfillmentMethod: "PICKUP",
      paymentMethod: "TRANSFER",
    });

    expect(order.requiresDeposit).toBe(false);
    expect(order.depositAmount).toBeNull();
  });
});
