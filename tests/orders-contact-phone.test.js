import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";

const prisma = (await import("../lib/prisma.js")).default;
const { app } = await import("../app.js");
const { CartModel } = await import("../services/cart.js");
const { seedTenants, seedTenantConfig, bearerFor } = await import("./helpers.js");

/**
 * Teléfono de contacto del cliente en el checkout.
 *
 * El caso que motivó todo esto: un pedido llegaba al panel sin ninguna forma de
 * contactar a quien compró. `Order.contactPhone` existía pero solo lo llenaba el
 * bot de WhatsApp; las órdenes del storefront nacían sin teléfono.
 */

let acme, acmeVariant, acmeProductId, acmeCustomer, acmeCustomerBearer;

async function addToCart() {
  await CartModel.add({
    tenantId: acme.id,
    userId: acmeCustomer.id,
    productId: acmeProductId,
    variantId: acmeVariant.id,
  });
}

function postOrder(body) {
  return request(app)
    .post("/store/orders")
    .set("X-Tenant-Slug", "acme")
    .set("Authorization", acmeCustomerBearer)
    .send({ fulfillmentMethod: "PICKUP", paymentMethod: "CASH", ...body });
}

/** Deja al cliente sin teléfono guardado, que es el estado de las cuentas viejas. */
async function clearStoredPhone() {
  await prisma.user.update({
    where: { id: acmeCustomer.id },
    data: { phone: null },
  });
}

async function setPolicy(overrides) {
  await seedTenantConfig(acme.id, {
    customerPhoneMode: "required",
    customerPhoneCountry: "54",
    customerPhoneArea: "264",
    ...overrides,
  });
}

beforeAll(async () => {
  ({ acme } = await seedTenants());
  acmeVariant = await prisma.productVariant.findFirst({
    where: { tenantId: acme.id },
  });
  acmeProductId = acmeVariant.productId;
  acmeCustomer = acme.users.find((u) => u.role === "CUSTOMER");
  acmeCustomerBearer = bearerFor(acmeCustomer);
});

beforeEach(async () => {
  await setPolicy({});
  await clearStoredPhone();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("modo required", () => {
  it("sin teléfono tipeado ni guardado → 400 CONTACT_PHONE_REQUIRED", async () => {
    await addToCart();
    const res = await postOrder({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("CONTACT_PHONE_REQUIRED");
  });

  it("el carrito sobrevive al rechazo", async () => {
    await addToCart();
    await postOrder({});

    // Se valida ANTES de abrir la transacción: nada de vaciar el carrito y
    // dejar a la persona sin pedido Y sin carrito.
    const cart = await prisma.cart.findFirst({
      where: { userId: acmeCustomer.id, tenantId: acme.id },
      include: { items: true },
    });
    expect(cart.items.length).toBeGreaterThan(0);
  });

  it("con teléfono local corto lo completa con la característica del tenant", async () => {
    await addToCart();
    const res = await postOrder({ contactPhone: "412-3456" });

    expect(res.status).toBe(201);
    const order = await prisma.order.findUnique({
      where: { id: res.body.order.id },
    });
    expect(order.contactPhone).toBe("5492644123456");
  });

  it("acepta un número de otra provincia sin tocarlo", async () => {
    // Alguien de Buenos Aires encargando para entregar en San Juan: su número
    // no es 264 y el pedido es igual de válido.
    await addToCart();
    const res = await postOrder({ contactPhone: "11 5555-1234" });

    expect(res.status).toBe(201);
    const order = await prisma.order.findUnique({
      where: { id: res.body.order.id },
    });
    expect(order.contactPhone).toBe("5491155551234");
  });

  it("un teléfono ilegible → 400 INVALID_CONTACT_PHONE", async () => {
    await addToCart();
    const res = await postOrder({ contactPhone: "123" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CONTACT_PHONE");
  });

  it("el teléfono queda guardado en la cuenta para el próximo checkout", async () => {
    await addToCart();
    await postOrder({ contactPhone: "264 15 412-3456" });

    const user = await prisma.user.findUnique({
      where: { id: acmeCustomer.id },
    });
    expect(user.phone).toBe("5492644123456");
  });

  it("usa el guardado si el checkout no manda ninguno", async () => {
    await prisma.user.update({
      where: { id: acmeCustomer.id },
      data: { phone: "5492644111111" },
    });

    await addToCart();
    const res = await postOrder({});

    expect(res.status).toBe(201);
    const order = await prisma.order.findUnique({
      where: { id: res.body.order.id },
    });
    expect(order.contactPhone).toBe("5492644111111");
  });

  it("el tipeado gana sobre el guardado, y NO pisa el de la cuenta", async () => {
    // Encargar para la casa de otra persona no debería cambiar el teléfono
    // propio de la cuenta.
    await prisma.user.update({
      where: { id: acmeCustomer.id },
      data: { phone: "5492644111111" },
    });

    await addToCart();
    const res = await postOrder({ contactPhone: "264 422-2222" });

    const order = await prisma.order.findUnique({
      where: { id: res.body.order.id },
    });
    const user = await prisma.user.findUnique({
      where: { id: acmeCustomer.id },
    });

    expect(order.contactPhone).toBe("5492644222222");
    expect(user.phone).toBe("5492644111111");
  });
});

describe("modo optional", () => {
  it("sin teléfono → 201 y la orden queda sin contacto", async () => {
    await setPolicy({ customerPhoneMode: "optional" });
    await addToCart();
    const res = await postOrder({});

    expect(res.status).toBe(201);
    const order = await prisma.order.findUnique({
      where: { id: res.body.order.id },
    });
    expect(order.contactPhone).toBeNull();
  });

  it("si viene y es ilegible igual avisa, no lo guarda mal", async () => {
    await setPolicy({ customerPhoneMode: "optional" });
    await addToCart();
    const res = await postOrder({ contactPhone: "123" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CONTACT_PHONE");
  });
});

describe("modo off", () => {
  it("ignora hasta un teléfono mandado a mano", async () => {
    await setPolicy({ customerPhoneMode: "off" });
    await addToCart();
    const res = await postOrder({ contactPhone: "264 412-3456" });

    expect(res.status).toBe(201);
    const order = await prisma.order.findUnique({
      where: { id: res.body.order.id },
    });
    expect(order.contactPhone).toBeNull();
  });
});

describe("sin característica configurada", () => {
  it("un número local corto no se puede reconstruir → 400", async () => {
    await setPolicy({ customerPhoneArea: null });
    await addToCart();
    const res = await postOrder({ contactPhone: "412-3456" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CONTACT_PHONE");
  });

  it("uno que ya trae la característica entra igual", async () => {
    await setPolicy({ customerPhoneArea: null });
    await addToCart();
    const res = await postOrder({ contactPhone: "264 412-3456" });

    expect(res.status).toBe(201);
    const order = await prisma.order.findUnique({
      where: { id: res.body.order.id },
    });
    expect(order.contactPhone).toBe("5492644123456");
  });
});

describe("nombre de contacto", () => {
  it("cae al username de la cuenta si no se manda uno", async () => {
    await addToCart();
    const res = await postOrder({ contactPhone: "264 412-3456" });

    const order = await prisma.order.findUnique({
      where: { id: res.body.order.id },
    });
    expect(order.contactName).toBe(acmeCustomer.username);
  });

  it("el mandado gana: el pedido puede recibirlo otra persona", async () => {
    await addToCart();
    const res = await postOrder({
      contactPhone: "264 412-3456",
      contactName: "Guada",
    });

    const order = await prisma.order.findUnique({
      where: { id: res.body.order.id },
    });
    expect(order.contactName).toBe("Guada");
  });
});
