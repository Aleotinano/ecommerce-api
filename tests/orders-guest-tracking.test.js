import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

const prisma = (await import("../lib/prisma.js")).default;
const { app } = await import("../app.js");
const { seedTenants, seedTenantConfig } = await import("./helpers.js");
const { ORDER_TRACKING_TTL_MS } = await import("../lib/tokens.js");

/**
 * Seguimiento de un pedido SIN cuenta (`GET /store/orders/track/:token`).
 *
 * El complemento de `orders-guest-checkout`: allá se prueba que el invitado pueda
 * COMPRAR, acá que pueda VOLVER A VER lo que compró. La credencial es el token
 * que devuelve el POST, no el teléfono — que es público y no autoriza nada.
 *
 * Lo que estos casos cuidan, en orden de importancia:
 *   1. que un token no sirva en otro tenant,
 *   2. que la respuesta no incluya datos que el link reenviado no debería llevar,
 *   3. que un link vencido o mal copiado no se distinga de uno inexistente.
 */

let acme, shopco, acmeVariant, acmeProductId;

beforeAll(async () => {
  ({ acme, shopco } = await seedTenants());
  await seedTenantConfig(acme.id, { socialWhatsapp: "+54 9 11 5555-1234" });
  acmeVariant = await prisma.productVariant.findFirst({
    where: { tenantId: acme.id },
  });
  acmeProductId = acmeVariant.productId;
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** Un pedido de invitado recién creado, con su token en claro. */
async function createGuestOrder() {
  const agent = request.agent(app);
  const cart = await agent
    .post(`/store/cart/${acmeProductId}`)
    .set("X-Tenant-Slug", "acme")
    .send({ variantId: acmeVariant.id });
  expect(cart.status).toBe(201);

  const res = await agent.post("/store/orders").set("X-Tenant-Slug", "acme").send({
    fulfillmentMethod: "PICKUP",
    paymentMethod: "CASH",
    contactName: "Juana Invitada",
    contactPhone: "264 412 3456",
  });
  expect(res.status).toBe(201);

  return { order: res.body.order, token: res.body.tracking?.token };
}

function track(token, slug = "acme") {
  return request(app).get(`/store/orders/track/${token}`).set("X-Tenant-Slug", slug);
}

describe("seguimiento de pedido de invitado", () => {
  it("el POST devuelve el token y la base guarda solo su hash", async () => {
    const { order, token } = await createGuestOrder();

    expect(typeof token).toBe("string");
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const saved = await prisma.order.findUnique({ where: { id: order.id } });
    // Lo guardado es un SHA-256 en hex, y no el token: si algún día alguien
    // persiste el token en claro, este caso lo caza.
    expect(saved.trackingTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(saved.trackingTokenHash).not.toBe(token);
  });

  it("con el token devuelve el pedido, sin sesión", async () => {
    const { order, token } = await createGuestOrder();

    const res = await track(token);

    expect(res.status).toBe(200);
    expect(res.body.order.id).toBe(order.id);
    expect(res.body.order.status).toBe("NEW");
    expect(res.body.order.total).toBe(order.total);
    expect(res.body.order.productos).toHaveLength(1);
    // El timeline es lo que la pantalla usa para contar en qué punto está.
    expect(res.body.order.timeline.length).toBeGreaterThan(0);
  });

  it("no expone el contacto ni el estado interno del pedido", async () => {
    const { token } = await createGuestOrder();

    const res = await track(token);

    // El link es un portador: quien lo reciba reenviado no se lleva el teléfono
    // de nadie.
    expect(res.body.order).not.toHaveProperty("contactPhone");
    expect(res.body.order).not.toHaveProperty("contactName");
    // Y el estado del motor es del backoffice: al cliente no le corresponde
    // saber que su pedido espera que alguien lo revise.
    expect(res.body.order).not.toHaveProperty("blockers");
    expect(res.body.order).not.toHaveProperty("canProduce");
    expect(res.body.order).not.toHaveProperty("payment");
  });

  it("un token de otro tenant no resuelve", async () => {
    const { token } = await createGuestOrder();

    const res = await track(token, shopco.slug);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TRACKING_NOT_FOUND");
  });

  it("un token inexistente da el mismo 404 que uno de otro tenant", async () => {
    const res = await track("aaaaaaaaaaaaaaaaaaaaaa");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TRACKING_NOT_FOUND");
  });

  it("un token vencido deja de abrir el pedido", async () => {
    const { order, token } = await createGuestOrder();

    // Un día más allá de la ventana: la caducidad se deriva de `createdAt`, así
    // que envejecer la orden es todo lo que hace falta.
    await prisma.order.update({
      where: { id: order.id },
      data: {
        createdAt: new Date(Date.now() - ORDER_TRACKING_TTL_MS - 86_400_000),
      },
    });

    const res = await track(token);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TRACKING_NOT_FOUND");
  });

  it("un token mal formado se rechaza sin tocar la base", async () => {
    // Le falta un carácter: el caso real es un link copiado cortado.
    const res = await track("aaaaaaaaaaaaaaaaaaaaa");

    expect(res.status).toBe(400);
  });
});
