import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import ExcelJS from "exceljs";

const prisma = (await import("../lib/prisma.js")).default;
const { app } = await import("../app.js");
const { ORDER_STATUS_CATALOG } = await import("../services/order-status.js");
const {
  FULFILLMENT_LABELS,
  PAYMENT_METHOD_LABELS,
  ORIGIN_LABELS,
  ordersFileName,
} = await import("../services/orders-export.js");
const { seedTenants, loginAs, cookieFor } = await import("./helpers.js");

// La planilla de órdenes: el equivalente del arqueo de caja para lo que se
// vendió. El admin la baja para el día de hoy, pero el endpoint acepta
// cualquier rango — y ahí está lo que hay que probar: que el rango recorte de
// verdad, porque una planilla que trae de más se firma igual.

let acme;
let shopco;
let acmeVariant;
let cookie;

/** Orden del tenant con una línea, fechada donde haga falta. */
async function orderWith({
  tenant,
  variant,
  status = "NEW",
  createdAt,
  total = variant.price,
  userId = null,
}) {
  return prisma.order.create({
    data: {
      tenantId: tenant.id,
      userId,
      status,
      total,
      ...(createdAt && { createdAt }),
      orderItems: {
        create: [
          {
            productId: variant.productId,
            variantId: variant.id,
            quantity: 2,
            price: variant.price,
          },
        ],
      },
    },
  });
}

/**
 * `GET /orders/export` con el cuerpo como Buffer: supertest parsea todo como
 * texto salvo que se le pida lo contrario, y un `.xlsx` es un zip.
 */
function getExport({ query = {}, as = cookie } = {}) {
  return request(app)
    .get("/orders/export")
    .query(query)
    .set("Cookie", as)
    .buffer()
    .parse((res, cb) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
}

/** Las filas de una hoja del workbook que devolvió el endpoint, sin el header. */
async function readSheet(body, name) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(body);

  const sheet = workbook.getWorksheet(name);
  const rows = [];
  sheet.eachRow((row, index) => {
    if (index > 1) rows.push(row.values);
  });

  return { sheet, rows };
}

const HOY = new Date();
const AYER = new Date(HOY.getTime() - 24 * 60 * 60 * 1000);
const day = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;

beforeAll(async () => {
  ({ acme, shopco } = await seedTenants());

  acmeVariant = await prisma.productVariant.findFirst({
    where: { tenantId: acme.id },
  });
  const shopcoVariant = await prisma.productVariant.findFirst({
    where: { tenantId: shopco.id },
  });

  await orderWith({ tenant: acme, variant: acmeVariant, status: "NEW" });
  await orderWith({
    tenant: acme,
    variant: acmeVariant,
    status: "COMPLETED",
  });
  // La de ayer: existe para que el filtro de rango tenga algo que dejar afuera.
  await orderWith({
    tenant: acme,
    variant: acmeVariant,
    status: "COMPLETED",
    createdAt: AYER,
  });
  // Del otro tenant: no puede aparecer en la planilla de Acme.
  await orderWith({ tenant: shopco, variant: shopcoVariant });

  ({ cookie } = await loginAs(app, { email: "admin@acme.com" }));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /orders/export", () => {
  it("responde un xlsx descargable con el nombre del día", async () => {
    const res = await getExport({ query: { from: day(HOY), to: day(HOY) } });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml.sheet");
    expect(res.headers["content-disposition"]).toContain(
      `ordenes-${day(HOY)}.xlsx`
    );
    // Sin esto el front no puede leer el nombre del archivo desde el blob.
    expect(res.headers["access-control-expose-headers"]).toContain(
      "Content-Disposition"
    );
    // Firma de un zip: un .xlsx es un zip, y un buffer vacío pasaría el resto.
    expect(res.body.subarray(0, 2).toString()).toBe("PK");
  });

  it("recorta por el rango pedido", async () => {
    const hoy = await getExport({ query: { from: day(HOY), to: day(HOY) } });
    const todo = await getExport();

    const { rows: filasDeHoy } = await readSheet(hoy.body, "Órdenes");
    const { rows: filasDeTodo } = await readSheet(todo.body, "Órdenes");

    expect(filasDeHoy).toHaveLength(2);
    // Las tres de Acme: las dos de hoy y la de ayer, que el rango dejaba afuera.
    expect(filasDeTodo).toHaveLength(3);
  });

  it("no exporta las órdenes de otro tenant", async () => {
    const { cookie: shopcoCookie } = await loginAs(app, {
      email: "admin@shopco.com",
    });

    const res = await getExport({ as: shopcoCookie });

    const { rows } = await readSheet(res.body, "Órdenes");
    expect(rows).toHaveLength(1);
  });

  it("respeta el filtro de estado del listado", async () => {
    const res = await getExport({ query: { status: "NEW" } });

    const { rows } = await readSheet(res.body, "Órdenes");
    expect(rows).toHaveLength(1);
  });

  it("trae una fila por línea de pedido en la hoja de ítems", async () => {
    const res = await getExport({ query: { from: day(HOY), to: day(HOY) } });

    const { rows } = await readSheet(res.body, "Ítems");

    // Dos órdenes de una línea cada una, con cantidad 2.
    expect(rows).toHaveLength(2);
    // `values` es 1-based: [ , orden, fecha, producto, variante, cantidad, ...]
    expect(rows[0][5]).toBe(2);
  });

  it("rechaza una fecha inválida", async () => {
    const res = await request(app)
      .get("/orders/export")
      .query({ from: "el martes" })
      .set("Cookie", cookie);

    expect(res.status).toBe(400);
  });

  it("no la puede pedir un cliente", async () => {
    const customerCookie = cookieFor(
      acme.users.find((u) => u.role === "CUSTOMER")
    );

    const res = await request(app)
      .get("/orders/export")
      .set("Cookie", customerCookie);

    expect(res.status).toBe(403);
  });
});

describe("etiquetas de la planilla", () => {
  it("cubre todos los estados del catálogo", async () => {
    const res = await getExport();
    const { rows } = await readSheet(res.body, "Órdenes");

    const labels = Object.values(ORDER_STATUS_CATALOG).map(
      (entry) => entry.admin.label
    );
    // La columna de estado nunca puede traer el enum crudo.
    for (const row of rows) expect(labels).toContain(row[5]);
  });

  it("no deja ningún enum de entrega, pago u origen sin etiqueta", () => {
    expect(Object.keys(FULFILLMENT_LABELS).sort()).toEqual([
      "DELIVERY",
      "PICKUP",
    ]);
    expect(Object.keys(PAYMENT_METHOD_LABELS).sort()).toEqual([
      "CASH",
      "MIXED",
      "TRANSFER",
    ]);
    expect(Object.keys(ORIGIN_LABELS).sort()).toEqual(["ADMIN", "BOT", "STORE"]);
  });
});

describe("ordersFileName", () => {
  it("usa un solo día cuando el rango es de un día", () => {
    const from = new Date(2026, 6, 1, 0, 0, 0, 0);
    const to = new Date(2026, 6, 1, 23, 59, 59, 999);

    expect(ordersFileName({ from, to })).toBe("ordenes-2026-07-01.xlsx");
  });

  it("usa los dos extremos cuando abarca varios", () => {
    const from = new Date(2026, 6, 1, 0, 0, 0, 0);
    const to = new Date(2026, 6, 31, 23, 59, 59, 999);

    expect(ordersFileName({ from, to })).toBe(
      "ordenes-2026-07-01_2026-07-31.xlsx"
    );
  });

  it("dice 'todo' cuando el rango es abierto", () => {
    expect(ordersFileName({})).toBe("ordenes-todo.xlsx");
  });
});
