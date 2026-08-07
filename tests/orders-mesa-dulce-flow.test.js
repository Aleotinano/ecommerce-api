import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

const prisma = (await import("../lib/prisma.js")).default;
const { app } = await import("../app.js");
const { seedTenants, seedTenantConfig, loginAs } = await import("./helpers.js");

/**
 * El ciclo completo de un pedido tal como lo vive el negocio real: SIN seña, con
 * los tres métodos de pago, de punta a punta y por HTTP (rutas + controllers +
 * servicio + libro de cobros).
 *
 * Es el camino de Mesa Dulce, que no cobra seña: el pedido entra, alguien lo
 * revisa, el dinero se registra cuando entra —transferencia antes de producir,
 * efectivo al entregar— y el estado avanza solo cuando puede.
 */

let acme;
let variant;
let productId;
let cookie;

beforeAll(async () => {
  ({ acme } = await seedTenants());
  // Sin seña: el tenant no la usa (depositEnabled queda en false por defecto).
  await seedTenantConfig(acme.id, { socialWhatsapp: "+54 9 264 555-1234" });

  variant = await prisma.productVariant.findFirst({ where: { tenantId: acme.id } });
  productId = variant.productId;

  ({ cookie } = await loginAs(app, { email: "admin@acme.com" }));
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** Un cliente invitado con un ítem en el carrito, como en la tienda real. */
async function guestWithCart() {
  const agent = request.agent(app);
  await agent
    .post(`/store/cart/${productId}`)
    .set("X-Tenant-Slug", "acme")
    .send({ variantId: variant.id });
  return agent;
}

const CONTACTO = { contactName: "Juana Cliente", contactPhone: "264 412 3456" };

const patch = (orderId, status) =>
  request(app).patch(`/orders/${orderId}`).set("Cookie", cookie).send({ status });

const detalle = (orderId) =>
  request(app).get(`/orders/${orderId}/payments`).set("Cookie", cookie);

describe("pedido en efectivo, retiro en el local", () => {
  it("se produce sin cobrar nada por adelantado y se cobra al entregar", async () => {
    const agent = await guestWithCart();
    const creada = await agent
      .post("/store/orders")
      .set("X-Tenant-Slug", "acme")
      .send({ fulfillmentMethod: "PICKUP", paymentMethod: "CASH", ...CONTACTO });

    expect(creada.status).toBe(201);
    const orderId = creada.body.order.id;

    // Lo único que le falta es el visto bueno de un humano: el efectivo se paga
    // contraentrega, así que el dinero no traba nada.
    const review = await request(app)
      .post(`/orders/${orderId}/review`)
      .set("Cookie", cookie)
      .send({});

    expect(review.status).toBe(200);
    expect(review.body.order.status).toBe("PROCESSING");
    expect(review.body.order.blockers).toEqual([]);

    expect((await patch(orderId, "READY")).body.order.status).toBe("READY");

    // Entregar es cobrar: la plata del mostrador entra en el mismo movimiento que
    // cierra el pedido, sin un segundo click. Antes de esto, una orden en efectivo
    // terminaba entregada y con el libro vacío — plata que no iba a aparecer en
    // ningún arqueo.
    const completada = await patch(orderId, "COMPLETED");
    expect(completada.body.order.status).toBe("COMPLETED");
    expect(completada.body.order.paymentStatus).toBe("PAID_IN_FULL");

    const { body } = await detalle(orderId);
    expect(body.payments).toHaveLength(1);
    expect(body.payments[0]).toMatchObject({ channel: "CASH", kind: "PAYMENT" });
    expect(body.payment.pending).toBe(0);
  });

  it("completar no cobra dos veces si la plata ya estaba registrada", async () => {
    const agent = await guestWithCart();
    const creada = await agent
      .post("/store/orders")
      .set("X-Tenant-Slug", "acme")
      .send({ fulfillmentMethod: "PICKUP", paymentMethod: "CASH", ...CONTACTO });

    const orderId = creada.body.order.id;
    await request(app).post(`/orders/${orderId}/review`).set("Cookie", cookie).send({});

    // El cliente pagó antes de retirar: la plata ya está en el libro.
    const cobro = await request(app)
      .post(`/orders/${orderId}/confirm-payment`)
      .set("Cookie", cookie)
      .send({});
    expect(cobro.body.order.paymentStatus).toBe("PAID_IN_FULL");

    await patch(orderId, "COMPLETED");

    const { body } = await detalle(orderId);
    expect(body.payments).toHaveLength(1);
    expect(body.payment.paid).toBe(variant.price);
  });
});

describe("pedido por transferencia, con envío", () => {
  it("no se produce hasta que la transferencia entra", async () => {
    const agent = await guestWithCart();
    const creada = await agent
      .post("/store/orders")
      .set("X-Tenant-Slug", "acme")
      .send({
        fulfillmentMethod: "DELIVERY",
        addressText: "Av. Libertador 1250",
        addressDetails: "Portón negro",
        paymentMethod: "TRANSFER",
        ...CONTACTO,
      });

    expect(creada.status).toBe(201);
    const orderId = creada.body.order.id;

    // Revisar no alcanza: falta la plata.
    const review = await request(app)
      .post(`/orders/${orderId}/review`)
      .set("Cookie", cookie)
      .send({});

    expect(review.body.order.status).toBe("NEW");
    expect(review.body.order.blockers.map((b) => b.code)).toEqual([
      "TRANSFER_NOT_CONFIRMED",
    ]);

    // Forzar la producción a mano tampoco: el guard es el mismo.
    const forzado = await patch(orderId, "PROCESSING");
    expect(forzado.status).toBe(409);
    expect(forzado.body.error.code).toBe("TRANSFER_NOT_CONFIRMED");

    const confirmada = await request(app)
      .post(`/orders/${orderId}/confirm-transfer`)
      .set("Cookie", cookie)
      .send({});

    expect(confirmada.status).toBe(200);
    expect(confirmada.body.order.status).toBe("PROCESSING");

    const { body } = await detalle(orderId);
    expect(body.payments).toHaveLength(1);
    expect(body.payments[0].channel).toBe("TRANSFER");
    expect(body.payment.settled).toBe(true);

    expect((await patch(orderId, "COMPLETED")).body.order.status).toBe("COMPLETED");
  });

  it("si entró solo una parte, sigue trabada por el saldo", async () => {
    const agent = await guestWithCart();
    const creada = await agent
      .post("/store/orders")
      .set("X-Tenant-Slug", "acme")
      .send({
        fulfillmentMethod: "PICKUP",
        paymentMethod: "TRANSFER",
        ...CONTACTO,
      });

    const orderId = creada.body.order.id;
    await request(app).post(`/orders/${orderId}/review`).set("Cookie", cookie).send({});

    // El cliente transfirió menos de lo que debía: quien confirma declara el
    // monto real, no el esperado.
    const parcial = await request(app)
      .post(`/orders/${orderId}/confirm-transfer`)
      .set("Cookie", cookie)
      .send({ amount: 1000 });

    expect(parcial.status).toBe(200);
    expect(parcial.body.order.status).toBe("NEW");
    expect(parcial.body.order.blockers.map((b) => b.code)).toContain(
      "TRANSFER_NOT_CONFIRMED"
    );

    const { body } = await detalle(orderId);
    expect(body.pending.TRANSFER).toBe(variant.price - 1000);
  });
});

describe("pedido mixto", () => {
  it("la transferencia destraba la producción y el efectivo se cobra al entregar", async () => {
    const agent = await guestWithCart();
    const total = variant.price;
    const creada = await agent
      .post("/store/orders")
      .set("X-Tenant-Slug", "acme")
      .send({
        fulfillmentMethod: "DELIVERY",
        addressText: "Rivadavia 480",
        paymentMethod: "MIXED",
        cashAmount: 1500,
        transferAmount: total - 1500,
        ...CONTACTO,
      });

    expect(creada.status).toBe(201);
    const orderId = creada.body.order.id;

    await request(app).post(`/orders/${orderId}/review`).set("Cookie", cookie).send({});

    const transferencia = await request(app)
      .post(`/orders/${orderId}/confirm-transfer`)
      .set("Cookie", cookie)
      .send({});

    expect(transferencia.body.order.status).toBe("PROCESSING");
    // Cobrada la parte transferida, pero la orden NO está saldada.
    expect(transferencia.body.order.paymentStatus).toBe("DEPOSIT_PAID");

    await patch(orderId, "READY");

    // Al entregar entra lo que faltaba: solo la parte en efectivo, porque la
    // transferida ya estaba en el libro.
    const completada = await patch(orderId, "COMPLETED");
    expect(completada.body.order.paymentStatus).toBe("PAID_IN_FULL");

    const { body } = await detalle(orderId);
    expect(body.payments).toHaveLength(2);
    expect(body.payments.map((p) => p.channel).sort()).toEqual(["CASH", "TRANSFER"]);
    expect(body.payments.reduce((sum, p) => sum + p.monto, 0)).toBe(total);
    expect(body.pending).toEqual({ CASH: 0, TRANSFER: 0 });
  });
});

describe("cancelar un pedido ya cobrado", () => {
  it("se cancela igual, y la devolución se registra a mano en el libro", async () => {
    const agent = await guestWithCart();
    const creada = await agent
      .post("/store/orders")
      .set("X-Tenant-Slug", "acme")
      .send({ fulfillmentMethod: "PICKUP", paymentMethod: "TRANSFER", ...CONTACTO });

    const orderId = creada.body.order.id;
    await request(app).post(`/orders/${orderId}/review`).set("Cookie", cookie).send({});
    await request(app)
      .post(`/orders/${orderId}/confirm-transfer`)
      .set("Cookie", cookie)
      .send({});

    expect((await patch(orderId, "CANCELLED")).body.order.status).toBe("CANCELLED");

    const devolucion = await request(app)
      .post(`/orders/${orderId}/payments`)
      .set("Cookie", cookie)
      .send({
        kind: "REFUND",
        channel: "TRANSFER",
        amount: variant.price,
        note: "Devuelto por transferencia",
      });

    expect(devolucion.status).toBe(201);
    // Devuelta entera, la orden queda REFUNDED y el pago no vuelve a PENDING: "se cobró y
    // se devolvió" tiene que poder distinguirse de "nunca se cobró".
    expect(devolucion.body.order.paymentStatus).toBe("REFUNDED");

    const { body } = await detalle(orderId);
    expect(body.payment.paid).toBe(0);
    expect(body.payment.charged).toBe(variant.price);
    expect(body.payment.refunded).toBe(variant.price);
  });
});
