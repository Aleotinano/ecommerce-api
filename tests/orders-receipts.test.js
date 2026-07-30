import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";

// Cloudinary mockeado: los comprobantes no salen a la red en los tests, pero SÍ
// se verifica con qué argumentos se lo llama — sobre todo en el borrado, donde
// mandar mal `resource_type`/`type` deja el archivo vivo sin fallar.
const { uploadMock, destroyMock, signMock } = vi.hoisted(() => ({
  uploadMock: vi.fn(),
  destroyMock: vi.fn(),
  signMock: vi.fn(),
}));
vi.mock("../lib/cloudinary.js", () => ({
  default: {
    uploader: { upload: uploadMock, destroy: destroyMock },
    utils: { private_download_url: signMock },
  },
}));

const prisma = (await import("../lib/prisma.js")).default;
const { app } = await import("../app.js");
const { OrderModel } = await import("../services/orders.js");
const { OrderReceiptModel } = await import("../services/order-receipts.js");
const { CartModel } = await import("../services/cart.js");
const { seedTenants, seedTenantConfig, loginAs, cookieFor } = await import(
  "./helpers.js"
);

let acme;
let acmeVariant;
let acmeCustomerId;
let cookie;
let staffCookie;
let shopcoCookie;

// Bytes reales de cada formato: el sniff de `middleware/upload.js` los mira, así
// que un fixture con contenido inventado no pasaría (que es justamente el punto).
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from("fixture de comprobante"),
]);
const PDF = Buffer.from("%PDF-1.4\n% comprobante de transferencia\n%%EOF\n");

const receiptsOf = (orderId) =>
  prisma.orderReceipt.findMany({ where: { orderId }, orderBy: { id: "asc" } });

function attachReceipt(req, { buffer = JPEG, filename = "comprobante.jpg", contentType = "image/jpeg" } = {}) {
  return req.attach("receipt", buffer, { filename, contentType });
}

beforeAll(async () => {
  const tenants = await seedTenants();
  acme = tenants.acme;
  await seedTenantConfig(acme.id);

  acmeVariant = await prisma.productVariant.findFirst({ where: { tenantId: acme.id } });
  acmeCustomerId = acme.users.find((u) => u.role === "CUSTOMER").id;

  ({ cookie } = await loginAs(app, { email: "admin@acme.com" }));

  const staff = await prisma.user.create({
    data: {
      tenantId: acme.id,
      username: "staff_acme",
      email: "staff@acme.com",
      password: "x",
      role: "STAFF",
      emailVerified: true,
    },
  });
  staffCookie = cookieFor(staff);

  shopcoCookie = cookieFor(tenants.shopco.users.find((u) => u.role === "ADMIN"));
});

beforeEach(() => {
  uploadMock.mockReset().mockImplementation(async (_path, options) => ({
    public_id: `${options.folder}/asset-${Math.random().toString(36).slice(2)}`,
    resource_type: options.resource_type,
    type: options.type,
    format: options.resource_type === "raw" ? undefined : "jpg",
    bytes: 1234,
  }));
  destroyMock.mockReset().mockResolvedValue({ result: "ok" });
  signMock.mockReset().mockImplementation((publicId) => `https://firmada.test/${publicId}?exp=1`);
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** Orden real desde el carrito, con el método de pago que se le pase. */
async function checkout(fulfillment = {}) {
  await CartModel.add({
    tenantId: acme.id,
    userId: acmeCustomerId,
    productId: acmeVariant.productId,
    variantId: acmeVariant.id,
  });

  return OrderModel.create({
    tenantId: acme.id,
    userId: acmeCustomerId,
    fulfillmentMethod: "PICKUP",
    paymentMethod: "TRANSFER",
    ...fulfillment,
  });
}

describe("POST /orders/:id/receipts", () => {
  it("adjunta una imagen sin confirmar nada", async () => {
    const order = await checkout();

    const res = await attachReceipt(
      request(app).post(`/orders/${order.id}/receipts`).set("Cookie", cookie)
    ).field("note", "Transferencia del 12/03");

    expect(res.status).toBe(201);
    expect(res.body.receipt).toMatchObject({
      orderId: order.id,
      mimeType: "image/jpeg",
      resourceType: "image",
      isPdf: false,
      note: "Transferencia del 12/03",
    });

    const [row] = await receiptsOf(order.id);
    // Lo central: hay evidencia y NO hay confirmación.
    expect(row.orderPaymentId).toBeNull();

    const fresh = await prisma.order.findUnique({ where: { id: order.id } });
    expect(fresh.transferConfirmedAt).toBeNull();
    expect(fresh.paymentStatus).toBe("PENDING");
    expect(await prisma.orderPayment.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("acepta PDF y lo sube como raw", async () => {
    const order = await checkout();

    const res = await attachReceipt(
      request(app).post(`/orders/${order.id}/receipts`).set("Cookie", cookie),
      { buffer: PDF, filename: "comprobante.pdf", contentType: "application/pdf" }
    );

    expect(res.status).toBe(201);
    expect(res.body.receipt).toMatchObject({ resourceType: "raw", isPdf: true });

    expect(uploadMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ resource_type: "raw", type: "authenticated" })
    );

    // Cloudinary no devuelve `format` en raw: se completa con la extensión del
    // archivo original, que es lo que después arma la URL de descarga.
    const [row] = await receiptsOf(order.id);
    expect(row.format).toBe("pdf");
  });

  it("rechaza un tipo no permitido", async () => {
    const order = await checkout();

    const res = await attachReceipt(
      request(app).post(`/orders/${order.id}/receipts`).set("Cookie", cookie),
      { buffer: Buffer.from("hola"), filename: "nota.txt", contentType: "text/plain" }
    );

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_RECEIPT_TYPE");
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("rechaza el archivo cuyo contenido no coincide con el tipo declarado", async () => {
    const order = await checkout();

    // Un PDF disfrazado de JPG: el mimetype del multipart lo declara el cliente,
    // así que el filtro por tipo lo deja pasar y lo que lo frena es mirar los bytes.
    const res = await attachReceipt(
      request(app).post(`/orders/${order.id}/receipts`).set("Cookie", cookie),
      { buffer: PDF, filename: "trucho.jpg", contentType: "image/jpeg" }
    );

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_RECEIPT_TYPE");
    expect(uploadMock).not.toHaveBeenCalled();
    expect(await receiptsOf(order.id)).toHaveLength(0);
  });

  it("rechaza un archivo que supera los 10MB", async () => {
    const order = await checkout();

    const grande = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.alloc(11 * 1024 * 1024, 0x41),
    ]);

    const res = await attachReceipt(
      request(app).post(`/orders/${order.id}/receipts`).set("Cookie", cookie),
      { buffer: grande }
    );

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("RECEIPT_TOO_LARGE");
  });

  it("no pisa: dos subidas son dos comprobantes", async () => {
    const order = await checkout();

    await attachReceipt(
      request(app).post(`/orders/${order.id}/receipts`).set("Cookie", cookie)
    );
    await attachReceipt(
      request(app).post(`/orders/${order.id}/receipts`).set("Cookie", cookie),
      { buffer: PDF, filename: "otro.pdf", contentType: "application/pdf" }
    );

    // El cliente puede mandar dos capturas de la misma transferencia, y pisar la
    // primera destruiría evidencia que quizá ya se usó para confirmar.
    expect(await receiptsOf(order.id)).toHaveLength(2);
    expect(destroyMock).not.toHaveBeenCalled();
  });

  it("404 si la orden no existe, sin subir nada al proveedor", async () => {
    const res = await attachReceipt(
      request(app).post("/orders/999999/receipts").set("Cookie", cookie)
    );

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ORDER_NOT_FOUND");
    expect(uploadMock).not.toHaveBeenCalled();
  });
});

describe("GET /orders/:id/receipts", () => {
  it("emite una URL firmada nueva y no expone el publicId", async () => {
    const order = await checkout();
    await attachReceipt(
      request(app).post(`/orders/${order.id}/receipts`).set("Cookie", cookie)
    );

    const res = await request(app)
      .get(`/orders/${order.id}/receipts`)
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.receipts).toHaveLength(1);

    const [receipt] = res.body.receipts;
    expect(receipt.url).toMatch(/^https:\/\/firmada\.test\//);
    // El publicId no sale nunca: con él se podría armar una URL por fuera del
    // backend y saltearse el vencimiento.
    expect(receipt.publicId).toBeUndefined();

    // La URL se emite en cada respuesta, no se guarda: la fila no tiene columna
    // para una URL usable, justamente para que no exista una que sobreviva.
    const [row] = await receiptsOf(order.id);
    expect(row.url).toBeUndefined();
    expect(signMock).toHaveBeenCalledWith(
      row.publicId,
      "jpg",
      expect.objectContaining({ expires_at: expect.any(Number) })
    );
  });
});

describe("POST /orders/:id/confirm-transfer con comprobante", () => {
  it("confirma y deja el comprobante enlazado a la fila del libro", async () => {
    const order = await checkout();

    const res = await attachReceipt(
      request(app)
        .post(`/orders/${order.id}/confirm-transfer`)
        .set("Cookie", cookie)
    );

    expect(res.status).toBe(200);
    expect(res.body.order.transferConfirmedAt).toBeTruthy();
    expect(res.body.order.paymentStatus).toBe("PAID_IN_FULL");

    const [payment] = await prisma.orderPayment.findMany({ where: { orderId: order.id } });
    const [receipt] = await receiptsOf(order.id);

    // Esto es lo que el trabajo entero venía a resolver: de la fila del cobro se
    // llega al archivo que se miró para darla por buena.
    expect(receipt.orderPaymentId).toBe(payment.id);
    expect(res.body.receiptId).toBe(receipt.id);
  });

  it("enlaza también los comprobantes ya cargados que se le pasen por receiptIds", async () => {
    const order = await checkout();

    const previo = await attachReceipt(
      request(app).post(`/orders/${order.id}/receipts`).set("Cookie", cookie)
    );

    const res = await request(app)
      .post(`/orders/${order.id}/confirm-transfer`)
      .set("Cookie", cookie)
      .send({ receiptIds: [previo.body.receipt.id] });

    expect(res.status).toBe(200);

    const [payment] = await prisma.orderPayment.findMany({ where: { orderId: order.id } });
    const receipt = await prisma.orderReceipt.findUnique({
      where: { id: previo.body.receipt.id },
    });
    expect(receipt.orderPaymentId).toBe(payment.id);
  });

  it("si la confirmación falla, no deja el comprobante colgado", async () => {
    const order = await checkout();

    await request(app)
      .post(`/orders/${order.id}/confirm-transfer`)
      .set("Cookie", cookie)
      .send({});

    const res = await attachReceipt(
      request(app)
        .post(`/orders/${order.id}/confirm-transfer`)
        .set("Cookie", cookie)
    );

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("TRANSFER_ALREADY_CONFIRMED");

    // El archivo se subió antes de la transacción (red adentro de una tx es
    // veneno), así que el rollback tiene que borrarlo a mano.
    expect(destroyMock).toHaveBeenCalled();
    const vivos = await prisma.orderReceipt.findMany({
      where: { orderId: order.id, deletedAt: null },
    });
    expect(vivos).toHaveLength(0);
  });

  it("sigue aceptando JSON puro, sin comprobante", async () => {
    const order = await checkout();

    const res = await request(app)
      .post(`/orders/${order.id}/confirm-transfer`)
      .set("Cookie", cookie)
      .send({ amount: 1000 });

    expect(res.status).toBe(200);
    expect(res.body.receiptId).toBeNull();
    expect(uploadMock).not.toHaveBeenCalled();
  });
});

describe("DELETE /orders/:id/receipts/:receiptId", () => {
  it("STAFF no puede borrar", async () => {
    const order = await checkout();
    const creado = await attachReceipt(
      request(app).post(`/orders/${order.id}/receipts`).set("Cookie", cookie)
    );

    const res = await request(app)
      .delete(`/orders/${order.id}/receipts/${creado.body.receipt.id}`)
      .set("Cookie", staffCookie);

    expect(res.status).toBe(403);
    expect(destroyMock).not.toHaveBeenCalled();
  });

  it("ADMIN borra el archivo del proveedor y deja la fila en soft-delete", async () => {
    const order = await checkout();
    const creado = await attachReceipt(
      request(app).post(`/orders/${order.id}/receipts`).set("Cookie", cookie),
      { buffer: PDF, filename: "comprobante.pdf", contentType: "application/pdf" }
    );

    const res = await request(app)
      .delete(`/orders/${order.id}/receipts/${creado.body.receipt.id}`)
      .set("Cookie", cookie);

    expect(res.status).toBe(204);

    // Sin `resource_type`/`type` correctos, `destroy` responde "not found" SIN
    // fallar y el PDF con el CBU se queda en Cloudinary para siempre.
    expect(destroyMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ resource_type: "raw", type: "authenticated" })
    );

    const row = await prisma.orderReceipt.findUnique({
      where: { id: creado.body.receipt.id },
    });
    // El HECHO de que hubo un comprobante sobrevive; el dato personal no.
    expect(row).not.toBeNull();
    expect(row.deletedAt).toBeTruthy();

    const listado = await request(app)
      .get(`/orders/${order.id}/receipts`)
      .set("Cookie", cookie);
    expect(listado.body.receipts).toHaveLength(0);
  });

  it("no marca la fila si el proveedor falla al borrar", async () => {
    const order = await checkout();
    const creado = await attachReceipt(
      request(app).post(`/orders/${order.id}/receipts`).set("Cookie", cookie)
    );

    destroyMock.mockRejectedValueOnce(new Error("cloudinary caído"));

    const res = await request(app)
      .delete(`/orders/${order.id}/receipts/${creado.body.receipt.id}`)
      .set("Cookie", cookie);

    expect(res.status).toBe(500);

    // Si se marcara igual, quedaría una orden diciendo "acá no hay nada" con el
    // archivo vivo en el proveedor y sin nada que lo apunte. Sin marcar, el
    // reintento lo vuelve a agarrar.
    const row = await prisma.orderReceipt.findUnique({
      where: { id: creado.body.receipt.id },
    });
    expect(row.deletedAt).toBeNull();
  });
});

describe("aislamiento por tenant", () => {
  it("otro tenant no ve ni borra el comprobante", async () => {
    const order = await checkout();
    const creado = await attachReceipt(
      request(app).post(`/orders/${order.id}/receipts`).set("Cookie", cookie)
    );

    const listado = await request(app)
      .get(`/orders/${order.id}/receipts`)
      .set("Cookie", shopcoCookie);
    expect(listado.status).toBe(404);

    const borrado = await request(app)
      .delete(`/orders/${order.id}/receipts/${creado.body.receipt.id}`)
      .set("Cookie", shopcoCookie);
    expect(borrado.status).toBe(404);

    const row = await prisma.orderReceipt.findUnique({
      where: { id: creado.body.receipt.id },
    });
    expect(row.deletedAt).toBeNull();
  });
});

describe("el blocker de transferencia cuenta los comprobantes", () => {
  it("distingue 'no mandó nada' de 'hay algo para revisar'", async () => {
    const order = await checkout();

    const sinComprobante = await request(app)
      .get(`/orders/${order.id}`)
      .set("Cookie", cookie);
    const blockerVacio = sinComprobante.body.order.blockers.find(
      (b) => b.code === "TRANSFER_NOT_CONFIRMED"
    );
    expect(blockerVacio.details.comprobantes).toBe(0);

    await attachReceipt(
      request(app).post(`/orders/${order.id}/receipts`).set("Cookie", cookie)
    );

    const conComprobante = await request(app)
      .get(`/orders/${order.id}`)
      .set("Cookie", cookie);
    const blocker = conComprobante.body.order.blockers.find(
      (b) => b.code === "TRANSFER_NOT_CONFIRMED"
    );
    // El panel puede decir "hay 1 comprobante sin revisar" en vez de solo "falta
    // confirmar", que es el estado intermedio que este diseño necesitaba mostrar.
    expect(blocker.details.comprobantes).toBe(1);
  });
});

describe("OrderReceiptModel.purgeExpired", () => {
  it("borra los que superaron la ventana, respeta los recientes y es idempotente", async () => {
    const order = await checkout();

    await attachReceipt(
      request(app).post(`/orders/${order.id}/receipts`).set("Cookie", cookie)
    );
    const viejoRes = await attachReceipt(
      request(app).post(`/orders/${order.id}/receipts`).set("Cookie", cookie)
    );

    const hace13Meses = new Date();
    hace13Meses.setMonth(hace13Meses.getMonth() - 13);
    await prisma.orderReceipt.update({
      where: { id: viejoRes.body.receipt.id },
      data: { createdAt: hace13Meses },
    });

    destroyMock.mockClear();
    const primera = await OrderReceiptModel.purgeExpired();

    expect(primera).toMatchObject({ found: 1, purged: 1, failed: [] });
    expect(destroyMock).toHaveBeenCalledTimes(1);

    const viejo = await prisma.orderReceipt.findUnique({
      where: { id: viejoRes.body.receipt.id },
    });
    expect(viejo.deletedAt).toBeTruthy();

    const vivos = await prisma.orderReceipt.findMany({
      where: { orderId: order.id, deletedAt: null },
    });
    expect(vivos).toHaveLength(1);

    destroyMock.mockClear();
    const segunda = await OrderReceiptModel.purgeExpired();
    expect(segunda).toMatchObject({ found: 0, purged: 0 });
    expect(destroyMock).not.toHaveBeenCalled();
  });
});
