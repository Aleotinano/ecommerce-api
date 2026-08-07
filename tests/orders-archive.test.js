import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";

const prisma = (await import("../lib/prisma.js")).default;
await import("../app.js");
const { OrderModel } = await import("../services/orders.js");
const { CashRegisterModel } = await import("../services/cash-register.js");
const { archiveOrder, summarizeArchivable } = await import(
  "../services/order-archive.js"
);
const { TERMINAL_STATUSES } = await import("../services/order-state.js");
const { seedTenants, seedTenantConfig } = await import("./helpers.js");

// Archivado de órdenes: sacar del tablero lo terminal sin sacarlo de la base, con
// el TURNO DE CAJA como definición del día. Ver services/order-archive.js.

let acme;
let adminId;
let customerId;

/** Orden directa por prisma: este archivo prueba el archivado, no el checkout. */
const nuevaOrden = (status, extra = {}) =>
  prisma.order.create({
    data: {
      tenantId: acme.id,
      userId: customerId,
      status,
      total: 1000,
      ...extra,
    },
  });

async function resetOrdenesYCaja() {
  await prisma.cashMovement.deleteMany({ where: { tenantId: acme.id } });
  await prisma.cashRegisterSession.deleteMany({ where: { tenantId: acme.id } });
  await prisma.orderItem.deleteMany({ where: { order: { tenantId: acme.id } } });
  await prisma.order.deleteMany({ where: { tenantId: acme.id } });
}

const abrirCaja = () =>
  CashRegisterModel.open({
    tenantId: acme.id,
    openingAmount: 0,
    openedById: adminId,
  });

const cerrarCaja = () =>
  CashRegisterModel.close({
    tenantId: acme.id,
    countedCashAmount: 0,
    closedById: adminId,
  });

beforeAll(async () => {
  ({ acme } = await seedTenants());
  await seedTenantConfig(acme.id, { cashRegisterEnabled: true });
  await CashRegisterModel.ensureDefaultCategories({ tenantId: acme.id });

  adminId = acme.users.find((u) => u.role === "ADMIN").id;
  customerId = acme.users.find((u) => u.role === "CUSTOMER").id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("qué se puede archivar", () => {
  it("terminal = estado sin transiciones de salida", () => {
    // Derivado de ORDER_TRANSITIONS, no escrito a mano: si mañana alguien agrega
    // un estado terminal, este test lo acompaña sin tocarse.
    expect([...TERMINAL_STATUSES].sort()).toEqual(["CANCELLED", "COMPLETED"]);
  });

  it("una orden abierta NO se archiva ni pidiéndolo a mano", async () => {
    await resetOrdenesYCaja();
    const orden = await nuevaOrden("PROCESSING");

    await expect(
      archiveOrder(prisma, { tenantId: acme.id, orderId: orden.id })
    ).rejects.toMatchObject({ code: "ORDER_NOT_ARCHIVABLE" });
  });

  it("archivar dos veces no re-sella el turno", async () => {
    await resetOrdenesYCaja();
    const orden = await nuevaOrden("COMPLETED");

    await archiveOrder(prisma, {
      tenantId: acme.id,
      orderId: orden.id,
      sessionId: 111,
    });
    // Un segundo intento con otro turno la movería de un arqueo ya firmado a otro.
    await archiveOrder(prisma, {
      tenantId: acme.id,
      orderId: orden.id,
      sessionId: 222,
    });

    const fresca = await prisma.order.findUnique({ where: { id: orden.id } });
    expect(fresca.cashSessionId).toBe(111);
  });
});

describe("el listado del backoffice esconde lo archivado", () => {
  beforeEach(async () => {
    await resetOrdenesYCaja();
    await nuevaOrden("COMPLETED", { archivedAt: new Date() });
    await nuevaOrden("COMPLETED");
    await nuevaOrden("NEW");
  });

  it("getUserOrders solo trae lo visible", async () => {
    const orders = await OrderModel.getUserOrders({ tenantId: acme.id, limit: 50 });

    expect(orders).toHaveLength(2);
    expect(orders.every((order) => order.archivedAt === null)).toBe(true);
  });

  it("los contadores cuentan lo mismo que el tablero muestra", async () => {
    const counts = await OrderModel.getStatusCounts({ tenantId: acme.id });

    // Si los counts no filtraran, la columna diría "Entregadas 2" y traería una.
    expect(counts.COMPLETED).toBe(1);
    expect(counts.NEW).toBe(1);
  });

  it("la planilla SÍ trae las archivadas", async () => {
    // El caso que rompe si el default se copia sin pensar: el Excel del día se baja
    // DESPUÉS de cerrar, cuando todo lo terminal ya está archivado.
    const orders = await OrderModel.getOrdersForExport({ tenantId: acme.id });

    expect(orders).toHaveLength(3);
  });
});

describe("cerrar el turno cierra el día", () => {
  let session;

  beforeAll(async () => {
    await resetOrdenesYCaja();
    session = await abrirCaja();

    await nuevaOrden("COMPLETED", { paymentStatus: "PAID_IN_FULL" });
    // Cancelada sin cobrar: es lo normal, no cuenta como plata que quedó afuera.
    await nuevaOrden("CANCELLED");
    await nuevaOrden("PROCESSING");
    await nuevaOrden("COMPLETED", { paymentStatus: "PENDING" });
  });

  it("previene lo que se lleva antes de firmar", async () => {
    const preview = await summarizeArchivable(prisma, { tenantId: acme.id });

    expect(preview).toEqual({ toArchive: 3, staysOpen: 1, unpaid: 1 });
  });

  it("archiva las terminales y deja las abiertas", async () => {
    const closed = await cerrarCaja();

    expect(closed.archivedOrders).toBe(3);

    const visibles = await OrderModel.getUserOrders({ tenantId: acme.id, limit: 50 });
    expect(visibles).toHaveLength(1);
    expect(visibles[0].status).toBe("PROCESSING");
  });

  it("las archivadas quedan colgadas del turno, con su hora", async () => {
    const detail = await CashRegisterModel.getById({
      tenantId: acme.id,
      id: session.id,
    });

    expect(detail.orders).toHaveLength(3);
    // El sello de la orden y el del arqueo tienen que poder leerse juntos.
    expect(detail.orders[0].id).toBeTypeOf("number");
    // Un turno cerrado ya no previene nada: la previsión es del abierto.
    expect(detail.ordersToClose).toBeNull();

    const archivada = await prisma.order.findUnique({
      where: { id: detail.orders[0].id },
    });
    expect(archivada.archivedById).toBe(adminId);
    expect(archivada.archivedAt.getTime()).toBe(detail.closedAt.getTime());
  });

  it("el turno siguiente arranca con la orden que quedó abierta", async () => {
    // El cierre ya dejó la caja abierta (es continua): el "turno siguiente" es esa
    // continuación, no una apertura nueva.
    const nueva = await CashRegisterModel.getCurrent({ tenantId: acme.id });
    const detail = await CashRegisterModel.getById({
      tenantId: acme.id,
      id: nueva.id,
    });

    expect(detail.orders).toHaveLength(0);
    expect(detail.ordersToClose).toEqual({
      toArchive: 0,
      staysOpen: 1,
      unpaid: 0,
    });
  });
});

describe("tenant sin caja habilitada", () => {
  beforeAll(async () => {
    await resetOrdenesYCaja();
    await prisma.tenantConfig.update({
      where: { tenantId: acme.id },
      data: { cashRegisterEnabled: false },
    });
    await nuevaOrden("COMPLETED");
  });

  afterAll(async () => {
    await prisma.tenantConfig.update({
      where: { tenantId: acme.id },
      data: { cashRegisterEnabled: true },
    });
  });

  it("no hay cierre, así que no se archiva nada", async () => {
    await expect(cerrarCaja()).rejects.toMatchObject({
      code: "CASH_REGISTER_DISABLED",
    });

    const orders = await OrderModel.getUserOrders({ tenantId: acme.id, limit: 50 });
    expect(orders).toHaveLength(1);
  });

  it("los contadores no se caen aunque la caja esté apagada", async () => {
    // `getStatusCounts` llama a `ensureScheduledSession` para que el día ruede sin
    // entrar a Caja; con el flag apagado tiene que devolver null y seguir.
    const counts = await OrderModel.getStatusCounts({ tenantId: acme.id });

    expect(counts.COMPLETED).toBe(1);
  });
});
