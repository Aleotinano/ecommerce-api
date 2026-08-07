import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

const prisma = (await import("../lib/prisma.js")).default;
const { app } = await import("../app.js");
const { ORDER_STATUS_CODES } = await import("../services/order-status.js");
const { seedTenants, loginAs, cookieFor } = await import("./helpers.js");

// Los encabezados del tablero de órdenes: cuántas hay por estado. El listado
// pagina POR COLUMNA, así que el total no se puede sacar contando lo que se
// trajo — sale de la base, y tiene que respetar el mismo `where` que el listado.

let acme;
let shopco;
let acmeVariant;
let shopcoVariant;
let cookie;

/** Orden mínima del tenant, con una línea para que la búsqueda tenga qué mirar. */
async function orderWith({ tenant, variant, status, userId = null }) {
  return prisma.order.create({
    data: {
      tenantId: tenant.id,
      userId,
      status,
      total: variant.price,
      orderItems: {
        create: [
          {
            productId: variant.productId,
            variantId: variant.id,
            quantity: 1,
            price: variant.price,
          },
        ],
      },
    },
  });
}

beforeAll(async () => {
  ({ acme, shopco } = await seedTenants());

  acmeVariant = await prisma.productVariant.findFirst({
    where: { tenantId: acme.id },
  });
  shopcoVariant = await prisma.productVariant.findFirst({
    where: { tenantId: shopco.id },
  });

  const acmeCustomerId = acme.users.find((u) => u.role === "CUSTOMER").id;

  await orderWith({ tenant: acme, variant: acmeVariant, status: "NEW" });
  await orderWith({
    tenant: acme,
    variant: acmeVariant,
    status: "NEW",
    userId: acmeCustomerId,
  });
  await orderWith({ tenant: acme, variant: acmeVariant, status: "PROCESSING" });
  await orderWith({ tenant: acme, variant: acmeVariant, status: "COMPLETED" });
  await orderWith({ tenant: acme, variant: acmeVariant, status: "CANCELLED" });

  // Del otro tenant: no tiene que aparecer en ningún contador de Acme.
  await orderWith({ tenant: shopco, variant: shopcoVariant, status: "NEW" });

  ({ cookie } = await loginAs(app, { email: "admin@acme.com" }));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /orders/counts", () => {
  it("cuenta las órdenes del tenant por estado", async () => {
    const res = await request(app).get("/orders/counts").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({
      NEW: 2,
      PROCESSING: 1,
      READY: 0,
      COMPLETED: 1,
      CANCELLED: 1,
    });
  });

  it("devuelve todos los códigos, incluso los que no tienen órdenes", async () => {
    const res = await request(app).get("/orders/counts").set("Cookie", cookie);

    // Una columna vacía se pinta igual: el front no tiene que defenderse de una
    // clave faltante.
    expect(Object.keys(res.body.counts).sort()).toEqual(
      [...ORDER_STATUS_CODES].sort()
    );
  });

  it("no cuenta las órdenes de otro tenant", async () => {
    const { cookie: shopcoCookie } = await loginAs(app, {
      email: "admin@shopco.com",
    });

    const res = await request(app)
      .get("/orders/counts")
      .set("Cookie", shopcoCookie);

    expect(res.status).toBe(200);
    expect(res.body.counts.NEW).toBe(1);
    expect(res.body.counts.COMPLETED).toBe(0);
  });

  it("aplica la misma búsqueda que el listado", async () => {
    const search = "customer_acme";

    const counts = await request(app)
      .get("/orders/counts")
      .query({ search })
      .set("Cookie", cookie);

    const listado = await request(app)
      .get("/orders/all")
      .query({ search, status: "NEW", limit: 100 })
      .set("Cookie", cookie);

    // Solo una de las dos NEW tiene usuario registrado: el contador tiene que
    // decir lo mismo que la columna que se ve.
    expect(counts.body.counts.NEW).toBe(1);
    expect(listado.body.orders).toHaveLength(counts.body.counts.NEW);
  });

  it("no la puede pedir un cliente", async () => {
    const customerCookie = cookieFor(
      acme.users.find((u) => u.role === "CUSTOMER")
    );

    const res = await request(app)
      .get("/orders/counts")
      .set("Cookie", customerCookie);

    expect(res.status).toBe(403);
  });
});
