import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

const prisma = (await import("../lib/prisma.js")).default;
const { app } = await import("../app.js");
const { seedTenants, seedTenantConfig } = await import("./helpers.js");

/**
 * Checkout SIN cuenta.
 *
 * El carrito ya funcionaba de invitado (cookie httpOnly `guest_cart_id`); lo que
 * se abrió acá es `POST /store/orders`, que antes exigía token. La contrapartida
 * es que el invitado tiene que dar nombre y teléfono sí o sí: sin cuenta, son los
 * dos únicos datos con los que el negocio puede llegar a esa persona.
 *
 * `request.agent(app)` es lo que hace de "navegador": persiste la cookie entre el
 * POST al carrito y el POST a la orden. Con `request(app)` suelto cada llamada
 * emitiría un guestId nuevo y el carrito saldría vacío.
 */

let acme, acmeVariant, acmeProductId;

beforeAll(async () => {
  ({ acme } = await seedTenants());
  await seedTenantConfig(acme.id, { socialWhatsapp: "+54 9 11 5555-1234" });
  acmeVariant = await prisma.productVariant.findFirst({
    where: { tenantId: acme.id },
  });
  acmeProductId = acmeVariant.productId;
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** Un "navegador" nuevo con su propia cookie de invitado y un ítem en el carrito. */
async function guestWithCart() {
  const agent = request.agent(app);
  const res = await agent
    .post(`/store/cart/${acmeProductId}`)
    .set("X-Tenant-Slug", "acme")
    .send({ variantId: acmeVariant.id });
  expect(res.status).toBe(201);
  return agent;
}

function postOrder(agent, body) {
  return agent.post("/store/orders").set("X-Tenant-Slug", "acme").send(body);
}

const VALID = {
  fulfillmentMethod: "PICKUP",
  paymentMethod: "CASH",
  contactName: "Juana Invitada",
  contactPhone: "264 412 3456",
};

describe("checkout de invitado", () => {
  it("crea la orden sin sesión: userId null, origin STORE y contacto persistido", async () => {
    const agent = await guestWithCart();
    const res = await postOrder(agent, VALID);

    expect(res.status).toBe(201);
    expect(res.body.order.origin).toBe("STORE");
    // Sin username de cuenta, el pedido se identifica con el nombre que dio.
    expect(res.body.order.user).toBe("Juana Invitada");

    const saved = await prisma.order.findUnique({
      where: { id: res.body.order.id },
    });
    expect(saved.userId).toBeNull();
    expect(saved.contactName).toBe("Juana Invitada");
    // Normalizado a E.164 por resolveContactPhone, listo para wa.me.
    expect(saved.contactPhone).toMatch(/^\d+$/);
    // Nace sin revisar, igual que cualquier orden STORE.
    expect(saved.reviewedAt).toBeNull();
  });

  it("deja el historial de estado sin autor en vez de romper", async () => {
    const agent = await guestWithCart();
    const res = await postOrder(agent, VALID);

    const history = await prisma.orderStatusHistory.findFirst({
      where: { orderId: res.body.order.id },
    });
    expect(history.toStatus).toBe("NEW");
    expect(history.changedById).toBeNull();
  });

  it("vacía el carrito de invitado al confirmar", async () => {
    const agent = await guestWithCart();
    await postOrder(agent, VALID);

    const res = await agent.get("/store/cart").set("X-Tenant-Slug", "acme");
    expect(res.status).toBe(200);
    expect(res.body.products).toHaveLength(0);
  });

  it("sin nombre → 400 CONTACT_NAME_REQUIRED", async () => {
    const agent = await guestWithCart();
    const res = await postOrder(agent, { ...VALID, contactName: undefined });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("CONTACT_NAME_REQUIRED");
  });

  it("sin teléfono → 400 CONTACT_PHONE_REQUIRED aunque el tenant lo tenga en 'off'", async () => {
    // El invitado es el caso donde la política del tenant no alcanza: sin cuenta
    // y sin teléfono el pedido queda incontactable, así que se pide igual.
    await seedTenantConfig(acme.id, { customerPhoneMode: "off" });
    try {
      const agent = await guestWithCart();
      const res = await postOrder(agent, { ...VALID, contactPhone: undefined });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("CONTACT_PHONE_REQUIRED");
    } finally {
      await seedTenantConfig(acme.id, { customerPhoneMode: "required" });
    }
  });

  it("con el carrito vacío → 400 EMPTY_CART, no 401", async () => {
    const agent = request.agent(app);
    const res = await postOrder(agent, VALID);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("EMPTY_CART");
  });

  it("el historial sigue pidiendo cuenta", async () => {
    const agent = await guestWithCart();
    await postOrder(agent, VALID);

    const list = await agent.get("/store/orders").set("X-Tenant-Slug", "acme");
    expect(list.status).toBe(401);
  });
});
