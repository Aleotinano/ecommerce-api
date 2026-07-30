import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import ExcelJS from "exceljs";

const prisma = (await import("../lib/prisma.js")).default;
const { app } = await import("../app.js");
const { CashRegisterModel, DEFAULT_CASH_CATEGORIES } = await import(
  "../services/cash-register.js"
);
const { seedTenants, seedTenantConfig, cookieFor } = await import("./helpers.js");

// Fase 1: la caja sola, sin enganche con órdenes. El enganche se prueba en
// tests/cash-register-orders.test.js.

let acme;
let shopco;
let acmeCookie;
let shopcoCookie;
let acmeStaffCookie;
let categorias;

const sueldos = () => categorias.find((c) => c.key === "sueldos");
const insumos = () => categorias.find((c) => c.key === "insumos");
const aporte = () => categorias.find((c) => c.key === "aporte-cambio");

/** Deja el tenant sin turnos ni movimientos, para que cada bloque parta limpio. */
async function resetSessions(tenantId) {
  await prisma.cashMovement.deleteMany({ where: { tenantId } });
  await prisma.cashRegisterSession.deleteMany({ where: { tenantId } });
}

beforeAll(async () => {
  ({ acme, shopco } = await seedTenants());

  // acme: caja habilitada. shopco: apagada (el default de todos los tenants hoy).
  await seedTenantConfig(acme.id, { cashRegisterEnabled: true });
  await seedTenantConfig(shopco.id, { storeName: "ShopCo" });

  await CashRegisterModel.ensureDefaultCategories({ tenantId: acme.id });
  categorias = await prisma.cashCategory.findMany({ where: { tenantId: acme.id } });

  const acmeAdmin = acme.users.find((u) => u.role === "ADMIN");
  acmeCookie = cookieFor(acmeAdmin);
  shopcoCookie = cookieFor(shopco.users.find((u) => u.role === "ADMIN"));

  // STAFF opera la caja pero no configura las etiquetas.
  const staff = await prisma.user.create({
    data: {
      tenantId: acme.id,
      username: "staff_caja",
      email: "staff.caja@acme.com",
      password: acmeAdmin.password,
      role: "STAFF",
      emailVerified: true,
    },
  });
  acmeStaffCookie = cookieFor(staff);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("flag cashRegisterEnabled", () => {
  it("tenant sin caja: 404 CASH_REGISTER_DISABLED en vez de un 403", async () => {
    // Para ese tenant el módulo no existe; no es que le falten permisos.
    const res = await request(app).get("/cash-register/current").set("Cookie", shopcoCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("CASH_REGISTER_DISABLED");
  });

  it("tenant sin caja: tampoco puede abrir", async () => {
    const res = await request(app)
      .post("/cash-register/open")
      .set("Cookie", shopcoCookie)
      .send({ openingAmount: 1000 });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("CASH_REGISTER_DISABLED");
  });

  it("sin token: 401", async () => {
    const res = await request(app).get("/cash-register/current");
    expect(res.status).toBe(401);
  });
});

describe("apertura y cierre", () => {
  beforeAll(async () => {
    await resetSessions(acme.id);
  });

  it("sin caja abierta, /current devuelve session null con 200", async () => {
    // "No hay caja abierta" es un estado normal que el panel tiene que pintar.
    const res = await request(app).get("/cash-register/current").set("Cookie", acmeCookie);

    expect(res.status).toBe(200);
    expect(res.body.session).toBeNull();
  });

  it("cerrar sin caja abierta → 409", async () => {
    const res = await request(app)
      .post("/cash-register/close")
      .set("Cookie", acmeCookie)
      .send({ countedCashAmount: 0 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CASH_SESSION_NOT_OPEN");
  });

  it("abre con el efectivo declarado", async () => {
    const res = await request(app)
      .post("/cash-register/open")
      .set("Cookie", acmeCookie)
      .send({ openingAmount: 5000, note: "arranca el turno" });

    expect(res.status).toBe(201);
    expect(res.body.session.status).toBe("OPEN");
    expect(res.body.session.openingAmount).toBe(5000);
    expect(res.body.session.openingNote).toBe("arranca el turno");
  });

  it("abrir con una ya abierta → 409 y NO crea una segunda fila", async () => {
    const res = await request(app)
      .post("/cash-register/open")
      .set("Cookie", acmeCookie)
      .send({ openingAmount: 999 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CASH_SESSION_ALREADY_OPEN");

    const abiertas = await prisma.cashRegisterSession.count({
      where: { tenantId: acme.id, status: "OPEN" },
    });
    expect(abiertas).toBe(1);
  });

  it("monto de apertura negativo → 400 de validación", async () => {
    await resetSessions(acme.id);

    const res = await request(app)
      .post("/cash-register/open")
      .set("Cookie", acmeCookie)
      .send({ openingAmount: -1 });

    expect(res.status).toBe(400);
  });

  it("arqueo completo: apertura 5000, +1000, −2000, contado 3900 → diferencia −100", async () => {
    await resetSessions(acme.id);

    await request(app)
      .post("/cash-register/open")
      .set("Cookie", acmeCookie)
      .send({ openingAmount: 5000 })
      .expect(201);

    await request(app)
      .post("/cash-register/movements")
      .set("Cookie", acmeCookie)
      .send({ type: "INCOME", channel: "CASH", amount: 1000, categoryId: aporte().id })
      .expect(201);

    await request(app)
      .post("/cash-register/movements")
      .set("Cookie", acmeCookie)
      .send({
        type: "EXPENSE",
        channel: "CASH",
        amount: 2000,
        categoryId: sueldos().id,
        payee: "Juan",
      })
      .expect(201);

    const current = await request(app)
      .get("/cash-register/current")
      .set("Cookie", acmeCookie);

    expect(current.body.session.totals.expectedCashAmount).toBe(4000);
    expect(current.body.session.totals.cashDifference).toBeNull();
    expect(current.body.session.movements).toHaveLength(2);

    const cerrada = await request(app)
      .post("/cash-register/close")
      .set("Cookie", acmeCookie)
      .send({ countedCashAmount: 3900, note: "faltan 100" });

    expect(cerrada.status).toBe(200);
    expect(cerrada.body.session.status).toBe("CLOSED");
    expect(cerrada.body.session.expectedCashAmount).toBe(4000);
    expect(cerrada.body.session.countedCashAmount).toBe(3900);
    expect(cerrada.body.session.cashDifference).toBe(-100);
  });

  it("un turno cerrado no acepta movimientos nuevos", async () => {
    // No hay caja abierta después del cierre anterior: el movimiento no tiene dónde
    // caer, y no se puede backdatear a la sesión ya arqueada.
    const res = await request(app)
      .post("/cash-register/movements")
      .set("Cookie", acmeCookie)
      .send({ type: "EXPENSE", channel: "CASH", amount: 50, categoryId: insumos().id });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CASH_SESSION_NOT_OPEN");
  });

  it("el arqueo guardado es un snapshot: un movimiento posterior no lo recalcula", async () => {
    const cerrada = await prisma.cashRegisterSession.findFirst({
      where: { tenantId: acme.id, status: "CLOSED" },
      orderBy: { id: "desc" },
    });

    // Se fuerza una fila en la sesión cerrada (por HTTP es imposible, ver test de
    // arriba) para confirmar que el detalle sigue devolviendo lo que se firmó.
    await prisma.cashMovement.create({
      data: {
        tenantId: acme.id,
        sessionId: cerrada.id,
        type: "EXPENSE",
        channel: "CASH",
        amount: 500,
        categoryId: insumos().id,
      },
    });

    const res = await request(app)
      .get(`/cash-register/${cerrada.id}`)
      .set("Cookie", acmeCookie);

    expect(res.body.session.totals.expectedCashAmount).toBe(4000);
    expect(res.body.session.totals.cashDifference).toBe(-100);
  });
});

describe("movimientos", () => {
  beforeAll(async () => {
    await resetSessions(acme.id);
    await request(app)
      .post("/cash-register/open")
      .set("Cookie", acmeCookie)
      .send({ openingAmount: 0 })
      .expect(201);
  });

  it("registra un sueldo con destinatario y etiqueta", async () => {
    const res = await request(app)
      .post("/cash-register/movements")
      .set("Cookie", acmeCookie)
      .send({
        type: "EXPENSE",
        channel: "CASH",
        amount: 20000,
        categoryId: sueldos().id,
        payee: "Juan Pérez",
        note: "quincena de julio",
      });

    expect(res.status).toBe(201);
    expect(res.body.movement.amount).toBe(20000);
    expect(res.body.movement.payee).toBe("Juan Pérez");
    expect(res.body.movement.category.key).toBe("sueldos");
    expect(res.body.movement.orderId).toBeNull();
  });

  it("STAFF puede registrar movimientos", async () => {
    const res = await request(app)
      .post("/cash-register/movements")
      .set("Cookie", acmeStaffCookie)
      .send({ type: "EXPENSE", channel: "CASH", amount: 300, categoryId: insumos().id });

    expect(res.status).toBe(201);
  });

  it("un tipo ORDER_* por HTTP → 400: esos los escribe solo el sistema", async () => {
    const res = await request(app)
      .post("/cash-register/movements")
      .set("Cookie", acmeCookie)
      .send({
        type: "ORDER_PAYMENT",
        channel: "CASH",
        amount: 1000,
        categoryId: sueldos().id,
      });

    expect(res.status).toBe(400);
  });

  it("GATEWAY no es una vía de caja → 400", async () => {
    const res = await request(app)
      .post("/cash-register/movements")
      .set("Cookie", acmeCookie)
      .send({ type: "INCOME", channel: "GATEWAY", amount: 10, categoryId: aporte().id });

    expect(res.status).toBe(400);
  });

  it("monto 0 o negativo → 400", async () => {
    for (const amount of [0, -50]) {
      const res = await request(app)
        .post("/cash-register/movements")
        .set("Cookie", acmeCookie)
        .send({ type: "EXPENSE", channel: "CASH", amount, categoryId: insumos().id });

      expect(res.status, `amount ${amount}`).toBe(400);
    }
  });

  it("sin etiqueta → 400: un egreso sin etiquetar no se puede reportar", async () => {
    const res = await request(app)
      .post("/cash-register/movements")
      .set("Cookie", acmeCookie)
      .send({ type: "EXPENSE", channel: "CASH", amount: 100 });

    expect(res.status).toBe(400);
  });

  it("etiqueta de otra dirección → 400 CASH_CATEGORY_KIND_MISMATCH", async () => {
    // "Sueldos" aplica a EXPENSE: un ingreso archivado ahí ensucia el reporte de
    // fin de mes, que es lo único que justifica que el catálogo exista.
    const res = await request(app)
      .post("/cash-register/movements")
      .set("Cookie", acmeCookie)
      .send({ type: "INCOME", channel: "CASH", amount: 100, categoryId: sueldos().id });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("CASH_CATEGORY_KIND_MISMATCH");
  });

  it("etiqueta de otro tenant → 404", async () => {
    const ajena = await prisma.cashCategory.create({
      data: { tenantId: shopco.id, key: "insumos", label: "Insumos" },
    });

    const res = await request(app)
      .post("/cash-register/movements")
      .set("Cookie", acmeCookie)
      .send({ type: "EXPENSE", channel: "CASH", amount: 100, categoryId: ajena.id });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("CASH_CATEGORY_NOT_FOUND");

    await prisma.cashCategory.delete({ where: { id: ajena.id } });
  });

  it("etiqueta desactivada → 409", async () => {
    const desactivada = await prisma.cashCategory.create({
      data: { tenantId: acme.id, key: "vieja", label: "Vieja", isActive: false },
    });

    const res = await request(app)
      .post("/cash-register/movements")
      .set("Cookie", acmeCookie)
      .send({ type: "EXPENSE", channel: "CASH", amount: 100, categoryId: desactivada.id });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CASH_CATEGORY_INACTIVE");

    await prisma.cashCategory.delete({ where: { id: desactivada.id } });
  });
});

describe("resumen por etiqueta", () => {
  beforeAll(async () => {
    await resetSessions(acme.id);
    await request(app)
      .post("/cash-register/open")
      .set("Cookie", acmeCookie)
      .send({ openingAmount: 1000 })
      .expect(201);

    const cargar = (body) =>
      request(app).post("/cash-register/movements").set("Cookie", acmeCookie).send(body).expect(201);

    await cargar({ type: "EXPENSE", channel: "CASH", amount: 20000, categoryId: sueldos().id });
    await cargar({ type: "EXPENSE", channel: "TRANSFER", amount: 5000, categoryId: sueldos().id });
    await cargar({ type: "EXPENSE", channel: "CASH", amount: 3000, categoryId: insumos().id });
    await cargar({ type: "INCOME", channel: "CASH", amount: 2000, categoryId: aporte().id });
  });

  it("separa sueldos de insumos, con signo y cantidad", async () => {
    const res = await request(app).get("/cash-register/summary").set("Cookie", acmeCookie);

    expect(res.status).toBe(200);
    expect(res.body.byCategory.sueldos).toMatchObject({ total: -25000, count: 2 });
    expect(res.body.byCategory.insumos).toMatchObject({ total: -3000, count: 1 });
    expect(res.body.byCategory["aporte-cambio"]).toMatchObject({ total: 2000, count: 1 });
  });

  it("agrupa por tipo y por vía", async () => {
    const res = await request(app).get("/cash-register/summary").set("Cookie", acmeCookie);

    expect(res.body.byType.EXPENSE).toBe(-28000);
    expect(res.body.byType.INCOME).toBe(2000);
    // El efectivo del cajón y lo que se pagó por transferencia se leen aparte.
    expect(res.body.byChannel.CASH).toBe(-21000);
    expect(res.body.byChannel.TRANSFER).toBe(-5000);
  });

  it("un rango que no incluye los movimientos devuelve vacío", async () => {
    const res = await request(app)
      .get("/cash-register/summary?from=2020-01-01&to=2020-01-31")
      .set("Cookie", acmeCookie);

    expect(res.body.byCategory).toEqual({});
  });
});

describe("catálogo de etiquetas", () => {
  it("el tenant arranca con las etiquetas por defecto sembradas", async () => {
    const res = await request(app).get("/cash-register/categories").set("Cookie", acmeCookie);

    expect(res.status).toBe(200);

    const propias = res.body.categories.filter((c) => !c.isSystem).map((c) => c.key);
    expect(propias).toEqual(DEFAULT_CASH_CATEGORIES.map((c) => c.key));
  });

  it("las etiquetas reservadas del sistema vienen marcadas y con su dirección", async () => {
    const res = await request(app).get("/cash-register/categories").set("Cookie", acmeCookie);
    const sistema = res.body.categories.filter((c) => c.isSystem);

    expect(sistema.map((c) => [c.key, c.applies])).toEqual([
      ["venta", "INCOME"],
      ["devolucion", "EXPENSE"],
    ]);
  });

  it("ensureDefaultCategories es idempotente", async () => {
    const antes = await prisma.cashCategory.count({ where: { tenantId: acme.id } });
    const result = await CashRegisterModel.ensureDefaultCategories({ tenantId: acme.id });
    const despues = await prisma.cashCategory.count({ where: { tenantId: acme.id } });

    expect(result.created).toBe(0);
    expect(despues).toBe(antes);
  });

  it("ADMIN crea una etiqueta propia", async () => {
    const res = await request(app)
      .post("/cash-register/categories")
      .set("Cookie", acmeCookie)
      .send({ key: "delivery", label: "Pago a repartidores", applies: "EXPENSE" });

    expect(res.status).toBe(201);
    expect(res.body.category.key).toBe("delivery");
  });

  it("clave repetida → 409", async () => {
    const res = await request(app)
      .post("/cash-register/categories")
      .set("Cookie", acmeCookie)
      .send({ key: "delivery", label: "Otra vez" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CASH_CATEGORY_DUPLICATE");
  });

  it("clave con formato inválido → 400", async () => {
    const res = await request(app)
      .post("/cash-register/categories")
      .set("Cookie", acmeCookie)
      .send({ key: "Pago Sueldos", label: "Sueldos" });

    expect(res.status).toBe(400);
  });

  it("STAFF no configura el catálogo", async () => {
    const res = await request(app)
      .post("/cash-register/categories")
      .set("Cookie", acmeStaffCookie)
      .send({ key: "otra", label: "Otra" });

    expect(res.status).toBe(403);
  });

  it("renombra la etiqueta sin tocar la clave", async () => {
    const categoria = await prisma.cashCategory.findFirst({
      where: { tenantId: acme.id, key: "delivery" },
    });

    const res = await request(app)
      .patch(`/cash-register/categories/${categoria.id}`)
      .set("Cookie", acmeCookie)
      .send({ label: "Repartidores", key: "otra-clave" });

    expect(res.status).toBe(200);
    expect(res.body.category.label).toBe("Repartidores");
    // `key` no está en el schema de update: es el slug estable.
    expect(res.body.category.key).toBe("delivery");
  });

  it("borra una etiqueta sin uso", async () => {
    const categoria = await prisma.cashCategory.findFirst({
      where: { tenantId: acme.id, key: "delivery" },
    });

    const res = await request(app)
      .delete(`/cash-register/categories/${categoria.id}`)
      .set("Cookie", acmeCookie);

    expect(res.status).toBe(200);
    expect(
      await prisma.cashCategory.findUnique({ where: { id: categoria.id } })
    ).toBeNull();
  });

  it("una etiqueta reservada no se puede usar a mano", async () => {
    // "Venta" significa exactamente "cobro de una orden": si se pudiera elegir a
    // mano, la cifra de ventas dejaría de tener una orden detrás.
    const venta = await prisma.cashCategory.findFirst({
      where: { tenantId: acme.id, key: "venta" },
    });

    const res = await request(app)
      .post("/cash-register/movements")
      .set("Cookie", acmeCookie)
      .send({ type: "INCOME", channel: "CASH", amount: 100, categoryId: venta.id });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("CASH_CATEGORY_RESERVED");
  });

  it("una etiqueta reservada se puede RENOMBRAR pero no desactivar ni dar vuelta", async () => {
    const venta = await prisma.cashCategory.findFirst({
      where: { tenantId: acme.id, key: "venta" },
    });

    // El nombre visible es del tenant: cada rubro le dice distinto.
    const renombrada = await request(app)
      .patch(`/cash-register/categories/${venta.id}`)
      .set("Cookie", acmeCookie)
      .send({ label: "Ingreso por pedidos" });

    expect(renombrada.status).toBe(200);
    expect(renombrada.body.category.label).toBe("Ingreso por pedidos");
    expect(renombrada.body.category.key).toBe("venta");

    // Desactivarla o volverla egreso rompería el próximo cobro de una orden.
    for (const body of [{ isActive: false }, { applies: "EXPENSE" }]) {
      const res = await request(app)
        .patch(`/cash-register/categories/${venta.id}`)
        .set("Cookie", acmeCookie)
        .send(body);

      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe("CASH_CATEGORY_RESERVED");
    }

    const borrada = await request(app)
      .delete(`/cash-register/categories/${venta.id}`)
      .set("Cookie", acmeCookie);

    expect(borrada.status).toBe(400);
    expect(borrada.body.error.code).toBe("CASH_CATEGORY_RESERVED");

    await prisma.cashCategory.update({ where: { id: venta.id }, data: { label: "Venta" } });
  });

  it("no se puede crear una etiqueta con una clave reservada", async () => {
    const res = await request(app)
      .post("/cash-register/categories")
      .set("Cookie", acmeCookie)
      .send({ key: "venta", label: "Mi venta", applies: "EXPENSE" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("CASH_CATEGORY_RESERVED");
  });

  it("una etiqueta con movimientos NO se borra: se desactiva", async () => {
    const res = await request(app)
      .delete(`/cash-register/categories/${sueldos().id}`)
      .set("Cookie", acmeCookie);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CASH_CATEGORY_IN_USE");

    const desactivada = await request(app)
      .patch(`/cash-register/categories/${sueldos().id}`)
      .set("Cookie", acmeCookie)
      .send({ isActive: false });

    expect(desactivada.status).toBe(200);
    expect(desactivada.body.category.isActive).toBe(false);

    // Y sigue apareciendo en el historial, que es el motivo de no borrarla.
    const listado = await request(app)
      .get("/cash-register/categories?includeInactive=true")
      .set("Cookie", acmeCookie);

    expect(listado.body.categories.map((c) => c.key)).toContain("sueldos");

    const activas = await request(app)
      .get("/cash-register/categories")
      .set("Cookie", acmeCookie);

    expect(activas.body.categories.map((c) => c.key)).not.toContain("sueldos");

    await prisma.cashCategory.update({
      where: { id: sueldos().id },
      data: { isActive: true },
    });
  });
});

describe("exportación a Excel", () => {
  let cerrada;

  beforeAll(async () => {
    // Turno propio: los bloques anteriores limpian las sesiones, así que este no
    // puede depender del que cerró "apertura y cierre".
    await resetSessions(acme.id);

    await request(app)
      .post("/cash-register/open")
      .set("Cookie", acmeCookie)
      .send({ openingAmount: 5000, note: "para exportar" })
      .expect(201);

    const cargar = (body) =>
      request(app)
        .post("/cash-register/movements")
        .set("Cookie", acmeCookie)
        .send(body)
        .expect(201);

    await cargar({
      type: "EXPENSE",
      channel: "CASH",
      amount: 2000,
      categoryId: sueldos().id,
      payee: "Juan",
    });
    await cargar({ type: "EXPENSE", channel: "CASH", amount: 500, categoryId: insumos().id });
    await cargar({ type: "EXPENSE", channel: "TRANSFER", amount: 1200, categoryId: insumos().id });

    await request(app)
      .post("/cash-register/close")
      .set("Cookie", acmeCookie)
      .send({ countedCashAmount: 2400 })
      .expect(200);

    cerrada = await prisma.cashRegisterSession.findFirst({
      where: { tenantId: acme.id, status: "CLOSED" },
      orderBy: { id: "desc" },
    });

    // 5000 − 2000 − 500 = 2500 esperado (la transferencia no entra), contado 2400.
    expect(cerrada.expectedCashAmount).toBe(2500);
    expect(cerrada.cashDifference).toBe(-100);
    expect(cerrada.transferTotal).toBe(-1200);
  });

  it("devuelve un .xlsx con el nombre del turno", async () => {
    const res = await request(app)
      .get(`/cash-register/${cerrada.id}/export`)
      .set("Cookie", acmeCookie)
      .buffer()
      .parse((res, cb) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
    expect(res.headers["content-disposition"]).toContain(
      `caja-turno-${cerrada.id}-`
    );
    // Firma de un zip: un .xlsx es un zip, y un buffer vacío pasaría el resto.
    expect(res.body.slice(0, 2).toString()).toBe("PK");
  });

  it("la planilla dice los mismos números que la API", async () => {
    // Se lee de vuelta con la misma librería: si el arqueo del Excel no coincide
    // con el de la API, la planilla es peor que no tenerla.
    const { buffer } = await CashRegisterModel.exportSession({
      tenantId: acme.id,
      id: cerrada.id,
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    expect(workbook.worksheets.map((s) => s.name)).toEqual([
      "Turno",
      "Movimientos",
      "Resumen",
    ]);

    const turno = workbook.getWorksheet("Turno");
    const campos = new Map();
    turno.eachRow((row) => campos.set(String(row.getCell(1).value), row.getCell(2).value));

    expect(campos.get("Efectivo esperado (ARS)")).toBe(cerrada.expectedCashAmount);
    expect(campos.get("Efectivo contado (ARS)")).toBe(cerrada.countedCashAmount);
    expect(campos.get("Diferencia (ARS)")).toBe(cerrada.cashDifference);

    const movimientos = workbook.getWorksheet("Movimientos");
    const filas = await prisma.cashMovement.count({ where: { sessionId: cerrada.id } });
    // +1 por el encabezado.
    expect(movimientos.rowCount).toBe(filas + 1);
  });

  it("los egresos salen con signo negativo, no como el monto crudo", async () => {
    const { buffer } = await CashRegisterModel.exportSession({
      tenantId: acme.id,
      id: cerrada.id,
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const movimientos = workbook.getWorksheet("Movimientos");
    const egresos = [];
    movimientos.eachRow((row, i) => {
      if (i === 1) return;
      if (row.getCell(2).value === "Egreso") egresos.push(row.getCell(6).value);
    });

    expect(egresos.length).toBeGreaterThan(0);
    for (const monto of egresos) expect(monto).toBeLessThan(0);
  });

  it("las fechas salen en hora local, no en UTC", async () => {
    // Una celda de fecha de Excel es hora de pared, sin zona: escribir el Date
    // crudo hacía que un turno abierto a las 19:44 se imprimiera "22:44".
    const { buffer } = await CashRegisterModel.exportSession({
      tenantId: acme.id,
      id: cerrada.id,
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const primero = await prisma.cashMovement.findFirst({
      where: { sessionId: cerrada.id },
      orderBy: { createdAt: "asc" },
    });

    const celda = workbook.getWorksheet("Movimientos").getRow(2).getCell(1).value;
    const esperado = new Date(
      primero.createdAt.getTime() - primero.createdAt.getTimezoneOffset() * 60_000
    );

    expect(celda.toISOString().slice(0, 16)).toBe(esperado.toISOString().slice(0, 16));
    // Y si el server no está en UTC, tiene que diferir del crudo: si coincidieran,
    // el shift no se aplicó.
    if (primero.createdAt.getTimezoneOffset() !== 0) {
      expect(celda.toISOString()).not.toBe(primero.createdAt.toISOString());
    }
  });

  it("un turno abierto también se exporta, sin arqueo", async () => {
    await resetSessions(acme.id);
    const abierta = await request(app)
      .post("/cash-register/open")
      .set("Cookie", acmeCookie)
      .send({ openingAmount: 700 })
      .expect(201);

    const { buffer } = await CashRegisterModel.exportSession({
      tenantId: acme.id,
      id: abierta.body.session.id,
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const campos = new Map();
    workbook
      .getWorksheet("Turno")
      .eachRow((row) => campos.set(String(row.getCell(1).value), row.getCell(2).value));

    expect(campos.get("Cierre")).toBe("el turno sigue abierto");
    expect(campos.get("Efectivo esperado (ARS)")).toBe(700);
    expect(campos.has("Diferencia (ARS)")).toBe(false);
  });

  // El scoping por tenant no se re-testea acá: `exportSession` va por `getById`,
  // que ya lo cubre en "aislamiento entre tenants".
});

describe("exportación del período", () => {
  it("trae todos los turnos del rango con su detalle y los totales", async () => {
    // "Mandame el Excel de julio": antes había que bajar turno por turno.
    const { buffer, filename } = await CashRegisterModel.exportPeriod({
      tenantId: acme.id,
    });

    expect(filename).toBe("caja-todo_todo.xlsx");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    expect(workbook.worksheets.map((s) => s.name)).toEqual([
      "Turnos",
      "Movimientos",
      "Resumen",
    ]);

    const turnos = await prisma.cashRegisterSession.count({ where: { tenantId: acme.id } });
    const movimientos = await prisma.cashMovement.count({ where: { tenantId: acme.id } });

    // +1 por el encabezado en cada hoja.
    expect(workbook.getWorksheet("Turnos").rowCount).toBe(turnos + 1);
    expect(workbook.getWorksheet("Movimientos").rowCount).toBe(movimientos + 1);
  });

  it("un rango sin turnos devuelve la planilla vacía, no un error", async () => {
    // Fechas LOCALES, que es lo que produce el schema a partir de "2020-01-01" /
    // "2020-01-31" (ver `dayBoundary`). Un `new Date("2020-01-01")` sería medianoche
    // UTC y con el server en UTC−3 caería en el 31 de diciembre.
    const { buffer, filename } = await CashRegisterModel.exportPeriod({
      tenantId: acme.id,
      from: new Date(2020, 0, 1),
      to: new Date(2020, 0, 31, 23, 59, 59, 999),
    });

    expect(filename).toBe("caja-2020-01-01_2020-01-31.xlsx");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    expect(workbook.getWorksheet("Turnos").rowCount).toBe(1); // solo el encabezado
  });

  it("por HTTP responde un .xlsx con el rango en el nombre", async () => {
    const res = await request(app)
      .get("/cash-register/export?from=2026-07-01&to=2026-07-31")
      .set("Cookie", acmeCookie)
      .buffer()
      .parse((res, cb) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("caja-2026-07-01_2026-07-31.xlsx");
    expect(res.body.slice(0, 2).toString()).toBe("PK");
  });

  it("un rango YYYY-MM-DD toma el día local completo, con el último día adentro", async () => {
    // `z.coerce.date()` parsearía "2026-07-31" como medianoche UTC y con el server en
    // UTC−3 el 31 quedaba afuera del "Excel de julio". Un día calendario no es un
    // instante: el `from` va al arranque del día local y el `to` al final.
    const hoy = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const dia = `${hoy.getFullYear()}-${pad(hoy.getMonth() + 1)}-${pad(hoy.getDate())}`;

    const res = await request(app)
      .get(`/cash-register?from=${dia}&to=${dia}`)
      .set("Cookie", acmeCookie);

    expect(res.status).toBe(200);
    // Los turnos de los bloques anteriores se abrieron hoy: si el rango de un solo
    // día no los incluyera, el filtro estaría corrido.
    expect(res.body.sessions.length).toBeGreaterThan(0);

    const abiertoHoy = await prisma.cashRegisterSession.count({
      where: {
        tenantId: acme.id,
        openedAt: {
          gte: new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()),
          lte: new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59, 999),
        },
      },
    });
    expect(res.body.total).toBe(abiertoHoy);
  });

  it("el turno cerrado sin conteo dice SIN CONTEO en la hoja de turnos", async () => {
    const turno = await prisma.cashRegisterSession.create({
      data: {
        tenantId: acme.id,
        openingAmount: 300,
        openedById: null,
        trigger: "AUTO",
        label: "Vencido",
        status: "CLOSED",
        closedAt: new Date(),
        closedWithoutCount: true,
        expectedCashAmount: 300,
        transferTotal: 0,
      },
    });

    const { buffer } = await CashRegisterModel.exportPeriod({ tenantId: acme.id });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    let fila = null;
    workbook.getWorksheet("Turnos").eachRow((row) => {
      if (row.getCell(1).value === turno.id) fila = row;
    });

    expect(fila).not.toBeNull();
    expect(fila.getCell(5).value).toBe("automático");
    expect(fila.getCell(6).value).toBe("sistema (vencido)");
    expect(fila.getCell(9).value).toBe("SIN CONTEO");
    expect(fila.getCell(10).value).toBe("—");

    await prisma.cashRegisterSession.delete({ where: { id: turno.id } });
  });
});

describe("aislamiento entre tenants", () => {
  it("la caja abierta de acme no se ve ni se cierra desde shopco", async () => {
    await seedTenantConfig(shopco.id, { cashRegisterEnabled: true });

    const propia = await request(app)
      .get("/cash-register/current")
      .set("Cookie", shopcoCookie);

    expect(propia.status).toBe(200);
    expect(propia.body.session).toBeNull();

    const cierre = await request(app)
      .post("/cash-register/close")
      .set("Cookie", shopcoCookie)
      .send({ countedCashAmount: 0 });

    expect(cierre.status).toBe(409);

    const abierta = await prisma.cashRegisterSession.findFirst({
      where: { tenantId: acme.id, status: "OPEN" },
    });
    expect(abierta).not.toBeNull();
  });

  it("el detalle de un turno de otro tenant → 404", async () => {
    const deAcme = await prisma.cashRegisterSession.findFirst({
      where: { tenantId: acme.id },
    });

    const res = await request(app)
      .get(`/cash-register/${deAcme.id}`)
      .set("Cookie", shopcoCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("CASH_SESSION_NOT_FOUND");
  });

  it("los dos tenants pueden tener su turno abierto a la vez", async () => {
    const abrir = await request(app)
      .post("/cash-register/open")
      .set("Cookie", shopcoCookie)
      .send({ openingAmount: 100 });

    expect(abrir.status).toBe(201);

    const abiertas = await prisma.cashRegisterSession.count({ where: { status: "OPEN" } });
    expect(abiertas).toBe(2);
  });
});

describe("historial", () => {
  it("lista los turnos de más nuevo a más viejo con la cantidad de movimientos", async () => {
    const res = await request(app).get("/cash-register").set("Cookie", acmeCookie);

    expect(res.status).toBe(200);
    expect(res.body.sessions.length).toBeGreaterThan(0);
    expect(res.body.sessions[0]._count.movements).toBeGreaterThanOrEqual(0);

    const fechas = res.body.sessions.map((s) => new Date(s.openedAt).getTime());
    expect(fechas).toEqual([...fechas].sort((a, b) => b - a));
  });

  it("limit arriba de 100 → 400", async () => {
    const res = await request(app)
      .get("/cash-register?limit=500")
      .set("Cookie", acmeCookie);

    expect(res.status).toBe(400);
  });
});
