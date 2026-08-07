import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";

const prisma = (await import("../lib/prisma.js")).default;
const { app } = await import("../app.js");
const { OrderModel } = await import("../services/orders.js");
const { CartModel } = await import("../services/cart.js");
const { CashRegisterModel } = await import("../services/cash-register.js");
const { seedTenants, seedTenantConfig, cookieFor } = await import("./helpers.js");

// Apertura automática por horario y cierre por vencimiento. La hora "ahora" no se
// puede mockear en el camino HTTP, así que el horario se arma alrededor del momento
// del test: un turno que empezó hace una hora y termina en una hora.

let acme;
let cookie;
let variant;
let adminId;
let customerId;

const pad = (n) => String(n).padStart(2, "0");
const hhmm = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
const shiftAt = (offsetHours) =>
  hhmm(new Date(Date.now() + offsetHours * 60 * 60 * 1000));

/** Horario que garantiza que AHORA estamos en el turno "Actual". */
const horarioVigente = () => [
  { label: "Actual", from: shiftAt(-1), to: shiftAt(1) },
];

async function setSchedule(cashSchedule) {
  await prisma.tenantConfig.update({
    where: { tenantId: acme.id },
    data: { cashSchedule },
  });
}

async function resetCaja() {
  await prisma.cashMovement.deleteMany({ where: { tenantId: acme.id } });
  await prisma.cashRegisterSession.deleteMany({ where: { tenantId: acme.id } });
}

async function checkout(fulfillment = { paymentMethod: "CASH" }) {
  await CartModel.add({
    tenantId: acme.id,
    userId: customerId,
    productId: variant.productId,
    variantId: variant.id,
  });

  return OrderModel.create({
    tenantId: acme.id,
    userId: customerId,
    fulfillmentMethod: "PICKUP",
    ...fulfillment,
  });
}

beforeAll(async () => {
  ({ acme } = await seedTenants());
  await seedTenantConfig(acme.id, { cashRegisterEnabled: true });
  await CashRegisterModel.ensureDefaultCategories({ tenantId: acme.id });

  variant = await prisma.productVariant.findFirst({ where: { tenantId: acme.id } });
  adminId = acme.users.find((u) => u.role === "ADMIN").id;
  customerId = acme.users.find((u) => u.role === "CUSTOMER").id;
  cookie = cookieFor(acme.users.find((u) => u.role === "ADMIN"));
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetCaja();
});

describe("apertura automática", () => {
  it("sin horario cargado sigue exigiendo abrir a mano", async () => {
    // La automatización es opt-in: quien no configuró turnos no cambia de operación.
    await setSchedule(null);
    const order = await checkout();

    await expect(
      OrderModel.confirmPayment({
        tenantId: acme.id,
        orderId: order.id,
        confirmedById: adminId,
      })
    ).rejects.toMatchObject({ code: "CASH_SESSION_NOT_OPEN" });

    expect(await prisma.cashRegisterSession.count({ where: { tenantId: acme.id } })).toBe(0);
  });

  it("en horario, un cobro abre el turno solo y el cobro entra", async () => {
    await setSchedule(horarioVigente());
    const order = await checkout();

    const cobrada = await OrderModel.confirmPayment({
      tenantId: acme.id,
      orderId: order.id,
      confirmedById: adminId,
    });

    expect(cobrada.paymentStatus).toBe("PAID_IN_FULL");

    const turno = await prisma.cashRegisterSession.findFirst({
      where: { tenantId: acme.id },
      include: { movements: true },
    });

    expect(turno.trigger).toBe("AUTO");
    expect(turno.label).toBe("Actual");
    expect(turno.expiresAt).not.toBeNull();
    expect(turno.movements).toHaveLength(1);
    expect(turno.movements[0].amount).toBe(order.total);
  });

  it("fuera de horario NO abre nada: el guard sigue valiendo", async () => {
    // Turno que ya terminó hace dos horas.
    await setSchedule([{ label: "Pasado", from: shiftAt(-4), to: shiftAt(-2) }]);
    const order = await checkout();

    await expect(
      OrderModel.confirmPayment({
        tenantId: acme.id,
        orderId: order.id,
        confirmedById: adminId,
      })
    ).rejects.toMatchObject({ code: "CASH_SESSION_NOT_OPEN" });

    expect(await prisma.cashRegisterSession.count({ where: { tenantId: acme.id } })).toBe(0);
  });

  it("abre con lo contado en el cierre anterior (el cajón arrastra)", async () => {
    await setSchedule(horarioVigente());

    // Turno previo cerrado contando 7300, y dejado cerrado a propósito: lo que se
    // prueba acá es la apertura automática, no la continuación del cierre.
    await CashRegisterModel.open({ tenantId: acme.id, openingAmount: 0, openedById: adminId });
    await CashRegisterModel.close({
      tenantId: acme.id,
      countedCashAmount: 7300,
      closedById: adminId,
      reopen: false,
    });

    const abierto = await CashRegisterModel.ensureScheduledSession({ tenantId: acme.id });

    expect(abierto.openingAmount).toBe(7300);
    expect(abierto.trigger).toBe("AUTO");
    expect(abierto.openingNote).toContain("arrastre");
  });

  it("un cierre SIN conteo arrastra el esperado: la plata siguió en el cajón", async () => {
    await setSchedule(horarioVigente());

    const previo = await CashRegisterModel.open({
      tenantId: acme.id,
      openingAmount: 5000,
      openedById: adminId,
    });
    await CashRegisterModel.closeWithoutCount({
      tenantId: acme.id,
      sessionId: previo.id,
      actorId: adminId,
    });

    const abierto = await CashRegisterModel.ensureScheduledSession({ tenantId: acme.id });

    // Nadie contó, pero el sistema sí sabe qué esperaba: saltear ese turno para
    // buscar el último arqueo firmado borraba del saldo todo lo del medio.
    expect(abierto.openingAmount).toBe(5000);
  });

  it("abrir a mano sin monto continúa la caja en vez de resetearla", async () => {
    await setSchedule(null);

    await CashRegisterModel.open({ tenantId: acme.id, openingAmount: 0, openedById: adminId });
    await CashRegisterModel.close({
      tenantId: acme.id,
      countedCashAmount: 4200,
      closedById: adminId,
      reopen: false,
    });

    const abierto = await CashRegisterModel.open({
      tenantId: acme.id,
      openedById: adminId,
    });

    expect(abierto.openingAmount).toBe(4200);
  });

  it("abrir a mano con 0 explícito sí arranca el cajón vacío", async () => {
    await setSchedule(null);

    await CashRegisterModel.open({ tenantId: acme.id, openingAmount: 0, openedById: adminId });
    await CashRegisterModel.close({
      tenantId: acme.id,
      countedCashAmount: 4200,
      closedById: adminId,
      reopen: false,
    });

    const abierto = await CashRegisterModel.open({
      tenantId: acme.id,
      openingAmount: 0,
      openedById: adminId,
    });

    expect(abierto.openingAmount).toBe(0);
  });

  it("no abre un segundo turno si ya hay uno abierto", async () => {
    await setSchedule(horarioVigente());

    const manual = await CashRegisterModel.open({
      tenantId: acme.id,
      openingAmount: 100,
      openedById: adminId,
    });
    const mismo = await CashRegisterModel.ensureScheduledSession({ tenantId: acme.id });

    expect(mismo.id).toBe(manual.id);
    expect(await prisma.cashRegisterSession.count({ where: { tenantId: acme.id } })).toBe(1);
  });

  it("GET /current abre el turno y lo devuelve marcado como automático", async () => {
    await setSchedule(horarioVigente());

    const res = await request(app).get("/cash-register/current").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.session).not.toBeNull();
    expect(res.body.session.trigger).toBe("AUTO");
    expect(res.body.session.vencido).toBe(false);
  });
});

describe("vencimiento y cierre sin conteo", () => {
  it("GET /current marca el turno vencido con los minutos de atraso", async () => {
    await setSchedule(horarioVigente());
    const turno = await CashRegisterModel.open({
      tenantId: acme.id,
      openingAmount: 0,
      openedById: adminId,
    });

    // Se lo vence a mano: 90 minutos de atraso.
    await prisma.cashRegisterSession.update({
      where: { id: turno.id },
      data: { expiresAt: new Date(Date.now() - 90 * 60 * 1000), label: "Viejo" },
    });

    const res = await request(app).get("/cash-register/current").set("Cookie", cookie);

    // Sigue abierto (el turno actual del horario es "Actual", distinto de "Viejo",
    // así que en rigor correspondía cerrarlo — ver el test siguiente).
    expect(res.status).toBe(200);
  });

  it("vencido dentro de la gracia: NO se lo cierra", async () => {
    await setSchedule(horarioVigente());
    const turno = await CashRegisterModel.open({
      tenantId: acme.id,
      openingAmount: 0,
      openedById: adminId,
    });

    // Venció hace 20 minutos: alguien puede estar contando la plata todavía.
    await prisma.cashRegisterSession.update({
      where: { id: turno.id },
      data: { expiresAt: new Date(Date.now() - 20 * 60 * 1000), label: "Viejo" },
    });

    const sigue = await CashRegisterModel.ensureScheduledSession({ tenantId: acme.id });

    expect(sigue.id).toBe(turno.id);
    expect(sigue.status).toBe("OPEN");

    const actualizado = await prisma.cashRegisterSession.findUnique({ where: { id: turno.id } });
    expect(actualizado.vencido).toBeUndefined(); // "vencido" no se persiste, se deriva
    expect(actualizado.status).toBe("OPEN");
  });

  it("vencido pasada la gracia y con otro turno vigente: lo cierra SIN arqueo y abre el nuevo", async () => {
    await setSchedule(horarioVigente());

    const viejo = await CashRegisterModel.open({
      tenantId: acme.id,
      openingAmount: 1000,
      openedById: adminId,
    });

    const insumos = await prisma.cashCategory.findFirst({
      where: { tenantId: acme.id, key: "insumos" },
    });
    await CashRegisterModel.addMovement({
      tenantId: acme.id,
      type: "EXPENSE",
      channel: "CASH",
      amount: 400,
      categoryId: insumos.id,
      createdById: adminId,
    });

    // Venció hace 3 horas y el turno de ahora es otro.
    await prisma.cashRegisterSession.update({
      where: { id: viejo.id },
      data: { expiresAt: new Date(Date.now() - 3 * 60 * 60 * 1000), label: "Viejo" },
    });

    const nuevo = await CashRegisterModel.ensureScheduledSession({ tenantId: acme.id });

    const cerrado = await prisma.cashRegisterSession.findUnique({ where: { id: viejo.id } });

    expect(cerrado.status).toBe("CLOSED");
    expect(cerrado.closedWithoutCount).toBe(true);
    // Lo que el sistema SÍ sabe se guarda; el arqueo, no: nadie contó.
    expect(cerrado.expectedCashAmount).toBe(600);
    expect(cerrado.countedCashAmount).toBeNull();
    expect(cerrado.cashDifference).toBeNull();
    expect(cerrado.closingNote).toContain("venció");

    expect(nuevo.id).not.toBe(viejo.id);
    expect(nuevo.trigger).toBe("AUTO");
    // La caja no se vacía porque nadie haya contado: se arrastra el esperado.
    expect(nuevo.openingAmount).toBe(600);
  });

  it("un cobro con el turno vencido cae en el turno nuevo, no en el viejo", async () => {
    await setSchedule(horarioVigente());

    const viejo = await CashRegisterModel.open({
      tenantId: acme.id,
      openingAmount: 0,
      openedById: adminId,
    });
    await prisma.cashRegisterSession.update({
      where: { id: viejo.id },
      data: { expiresAt: new Date(Date.now() - 3 * 60 * 60 * 1000), label: "Viejo" },
    });

    const order = await checkout();
    await OrderModel.confirmPayment({
      tenantId: acme.id,
      orderId: order.id,
      confirmedById: adminId,
    });

    const movimiento = await prisma.cashMovement.findFirst({ where: { orderId: order.id } });

    expect(movimiento.sessionId).not.toBe(viejo.id);
  });

  it("el turno cerrado sin conteo no suma a la diferencia acumulada, se cuenta aparte", async () => {
    await setSchedule(horarioVigente());

    const sinContar = await CashRegisterModel.open({
      tenantId: acme.id,
      openingAmount: 0,
      openedById: adminId,
    });
    await CashRegisterModel.closeWithoutCount({
      tenantId: acme.id,
      sessionId: sinContar.id,
      actorId: adminId,
    });

    const contado = await CashRegisterModel.open({
      tenantId: acme.id,
      openingAmount: 500,
      openedById: adminId,
    });
    await CashRegisterModel.close({
      tenantId: acme.id,
      countedCashAmount: 450,
      closedById: adminId,
    });

    const res = await request(app).get("/stats/dashboard").set("Cookie", cookie);
    const { caja } = res.body.dashboard;

    expect(caja.turnosCerrados).toBe(2);
    // Solo el que se contó aporta diferencia.
    expect(caja.diferenciaAcumulada).toBe(-50);
    expect(caja.turnosConDiferencia).toBe(1);
    expect(caja.turnosSinArqueo).toBe(1);
    expect(contado.id).not.toBe(sinContar.id);
  });

  it("el Excel del turno sin conteo dice SIN CONTEO, no diferencia 0", async () => {
    const ExcelJS = (await import("exceljs")).default;

    const turno = await CashRegisterModel.open({
      tenantId: acme.id,
      openingAmount: 2000,
      openedById: adminId,
    });
    await CashRegisterModel.closeWithoutCount({
      tenantId: acme.id,
      sessionId: turno.id,
      actorId: adminId,
      note: "venció el turno Mañana",
    });

    const { buffer } = await CashRegisterModel.exportSession({
      tenantId: acme.id,
      id: turno.id,
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const campos = new Map();
    workbook
      .getWorksheet("Turno")
      .eachRow((row) => campos.set(String(row.getCell(1).value), row.getCell(2).value));

    expect(campos.get("Cerró")).toBe("el sistema (turno vencido)");
    expect(campos.get("Arqueo")).toContain("SIN CONTEO");
    expect(campos.get("Efectivo esperado (ARS)")).toBe(2000);
    expect(campos.has("Diferencia (ARS)")).toBe(false);
  });
});

// El caso de Mesa Dulce: un único turno diario. Comparar SOLO la etiqueta dejaba el
// turno de ayer abierto para siempre —hoy el turno vigente se llama igual— y los
// cobros del día caían adentro del de ayer. Los tests viejos no lo agarraban porque
// todos forzaban `label: "Viejo"`.
describe("un solo turno por día", () => {
  it("el turno de ayer se cierra sin conteo y arranca el de hoy, con el mismo nombre", async () => {
    await setSchedule([{ label: "Día", from: shiftAt(-1), to: shiftAt(1) }]);

    const ayer = await CashRegisterModel.open({
      tenantId: acme.id,
      openingAmount: 1000,
      openedById: adminId,
    });

    // La ocurrencia de AYER: mismo turno, misma etiqueta, vencida hace 23 horas.
    await prisma.cashRegisterSession.update({
      where: { id: ayer.id },
      data: {
        openedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() - 23 * 60 * 60 * 1000),
      },
    });

    const hoy = await CashRegisterModel.ensureScheduledSession({ tenantId: acme.id });
    const cerrado = await prisma.cashRegisterSession.findUnique({ where: { id: ayer.id } });

    expect(cerrado.status).toBe("CLOSED");
    expect(cerrado.closedWithoutCount).toBe(true);

    expect(hoy.id).not.toBe(ayer.id);
    expect(hoy.label).toBe("Día");
    expect(hoy.openingAmount).toBe(1000);
  });

  it("dentro de la MISMA ocurrencia no se cierra, aunque el vencimiento quedó viejo", async () => {
    // Le editaron el horario al turno que ya estaba corriendo: su `expiresAt`
    // materializado quedó atrás, pero sigue siendo el turno de hoy.
    await setSchedule([{ label: "Día", from: shiftAt(-3), to: shiftAt(1) }]);

    const turno = await CashRegisterModel.open({
      tenantId: acme.id,
      openingAmount: 0,
      openedById: adminId,
    });
    await prisma.cashRegisterSession.update({
      where: { id: turno.id },
      data: { expiresAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    });

    const mismo = await CashRegisterModel.ensureScheduledSession({ tenantId: acme.id });

    expect(mismo.id).toBe(turno.id);
    expect(mismo.status).toBe("OPEN");
  });
});

// La caja lleva dos saldos: el cajón y la cuenta. Los dos arrastran de un turno al
// siguiente — antes las transferencias empezaban en cero todos los días, aunque la
// plata siguiera en el banco.
describe("saldo de transferencias", () => {
  const transferencia = async (type, amount) => {
    const etiqueta = await prisma.cashCategory.findFirst({
      where: { tenantId: acme.id, key: type === "INCOME" ? "aporte-cambio" : "insumos" },
    });
    return CashRegisterModel.addMovement({
      tenantId: acme.id,
      type,
      channel: "TRANSFER",
      amount,
      categoryId: etiqueta.id,
      createdById: adminId,
    });
  };

  it("abrir sin montos arrastra los DOS saldos del cierre anterior", async () => {
    await setSchedule(null);

    await CashRegisterModel.open({
      tenantId: acme.id,
      openingAmount: 0,
      openingTransferAmount: 0,
      openedById: adminId,
    });
    await transferencia("INCOME", 9000);
    await CashRegisterModel.close({
      tenantId: acme.id,
      countedCashAmount: 1500,
      countedTransferAmount: 9000,
      closedById: adminId,
      reopen: false,
    });

    const abierto = await CashRegisterModel.open({
      tenantId: acme.id,
      openedById: adminId,
    });

    expect(abierto.openingAmount).toBe(1500);
    expect(abierto.openingTransferAmount).toBe(9000);
  });

  it("cerrar contando los dos deja las dos diferencias y la caja sigue con lo contado", async () => {
    await setSchedule(null);

    await CashRegisterModel.open({
      tenantId: acme.id,
      openingAmount: 1000,
      openingTransferAmount: 5000,
      openedById: adminId,
    });
    await transferencia("INCOME", 2000);

    const cerrado = await CashRegisterModel.close({
      tenantId: acme.id,
      countedCashAmount: 900,
      countedTransferAmount: 7100,
      closedById: adminId,
    });

    expect(cerrado.expectedTransferAmount).toBe(7000);
    expect(cerrado.cashDifference).toBe(-100);
    expect(cerrado.transferDifference).toBe(100);

    expect(cerrado.nextSession.openingAmount).toBe(900);
    expect(cerrado.nextSession.openingTransferAmount).toBe(7100);
  });

  it("sin contar el banco, el saldo sigue con el esperado y no hay diferencia firmada", async () => {
    await setSchedule(null);

    await CashRegisterModel.open({
      tenantId: acme.id,
      openingAmount: 0,
      openingTransferAmount: 3000,
      openedById: adminId,
    });
    await transferencia("INCOME", 1000);

    const cerrado = await CashRegisterModel.close({
      tenantId: acme.id,
      countedCashAmount: 0,
      closedById: adminId,
    });

    expect(cerrado.transferDifference).toBeNull();
    expect(cerrado.countedTransferAmount).toBeNull();
    expect(cerrado.nextSession.openingTransferAmount).toBe(4000);
  });

  it("un turno cerrado antes de esta columna arrastra su neto de transferencias", async () => {
    // Retrocompat: los cierres viejos no tienen `expectedTransferAmount`, y lo más
    // cercano que guardaron es el neto del turno.
    await setSchedule(null);

    const viejo = await CashRegisterModel.open({
      tenantId: acme.id,
      openingAmount: 0,
      openedById: adminId,
    });
    await CashRegisterModel.close({
      tenantId: acme.id,
      countedCashAmount: 0,
      closedById: adminId,
      reopen: false,
    });

    // Se lo deja como lo dejaría una fila anterior a la migración.
    await prisma.cashRegisterSession.update({
      where: { id: viejo.id },
      data: {
        expectedTransferAmount: null,
        countedTransferAmount: null,
        transferTotal: 6500,
      },
    });

    const abierto = await CashRegisterModel.open({
      tenantId: acme.id,
      openedById: adminId,
    });

    expect(abierto.openingTransferAmount).toBe(6500);
  });
});

describe("cerrar el día deja la caja abierta", () => {
  it("el turno siguiente arranca con lo contado, en horario y con etiqueta", async () => {
    await setSchedule(horarioVigente());
    await CashRegisterModel.open({ tenantId: acme.id, openingAmount: 0, openedById: adminId });

    const cerrado = await CashRegisterModel.close({
      tenantId: acme.id,
      countedCashAmount: 5000,
      closedById: adminId,
    });

    expect(cerrado.nextSession.openingAmount).toBe(5000);
    expect(cerrado.nextSession.label).toBe("Actual");
    expect(cerrado.nextSession.expiresAt).not.toBeNull();
    expect(cerrado.nextSession.openingNote).toContain("Continúa");

    // Una sola caja abierta: el arqueo no tendría sentido con dos.
    expect(
      await prisma.cashRegisterSession.count({
        where: { tenantId: acme.id, status: "OPEN" },
      })
    ).toBe(1);
  });

  it("cerrando fuera de horario la caja sigue igual, y vence cuando arranca el próximo turno", async () => {
    // Cerrar el día 20:05 cuando el turno terminaba 20:00. Si no reabriera, un cobro
    // en efectivo a las 20:10 se rechaza; si reabriera sin vencimiento, los cobros de
    // mañana caerían adentro de hoy.
    await setSchedule([{ label: "Mañana", from: shiftAt(2), to: shiftAt(4) }]);
    await CashRegisterModel.open({ tenantId: acme.id, openingAmount: 0, openedById: adminId });

    const cerrado = await CashRegisterModel.close({
      tenantId: acme.id,
      countedCashAmount: 800,
      closedById: adminId,
    });

    expect(cerrado.nextSession.openingAmount).toBe(800);
    expect(cerrado.nextSession.label).toBeNull();
    expect(cerrado.nextSession.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("`reopen: false` deja la caja cerrada", async () => {
    await setSchedule(horarioVigente());
    await CashRegisterModel.open({ tenantId: acme.id, openingAmount: 0, openedById: adminId });

    const cerrado = await CashRegisterModel.close({
      tenantId: acme.id,
      countedCashAmount: 300,
      closedById: adminId,
      reopen: false,
    });

    expect(cerrado.nextSession).toBeNull();
    expect(
      await prisma.cashRegisterSession.count({
        where: { tenantId: acme.id, status: "OPEN" },
      })
    ).toBe(0);
  });

  it("el cierre y su continuación son un solo hecho: dos cierres seguidos encadenan", async () => {
    // Cierre, archivado y continuación viven en la misma transacción, así que la
    // cadena no puede cortarse por la mitad: cada turno abre con lo que firmó el
    // anterior, sin que nadie vuelva a declarar el fondo.
    await setSchedule(horarioVigente());
    await CashRegisterModel.open({ tenantId: acme.id, openingAmount: 0, openedById: adminId });

    const primero = await CashRegisterModel.close({
      tenantId: acme.id,
      countedCashAmount: 2000,
      closedById: adminId,
    });
    const segundo = await CashRegisterModel.close({
      tenantId: acme.id,
      countedCashAmount: 2000,
      closedById: adminId,
    });

    expect(segundo.openingAmount).toBe(primero.nextSession.openingAmount);
    expect(segundo.cashDifference).toBe(0);
    expect(segundo.nextSession.openingAmount).toBe(2000);

    const abiertas = await prisma.cashRegisterSession.count({
      where: { tenantId: acme.id, status: "OPEN" },
    });
    expect(abiertas).toBe(1);
  });
});

describe("caja chica y caja grande", () => {
  // Lo que pidió el local: la plata se lleva todos los días y queda un fondo para
  // arrancar mañana. Sin esto, la caja del día siguiente amanecía con plata que ya no
  // está en el cajón.
  it("retirar una parte deja la caja chica para el turno siguiente", async () => {
    await setSchedule(horarioVigente());
    await CashRegisterModel.open({ tenantId: acme.id, openingAmount: 0, openedById: adminId });

    const cerrado = await CashRegisterModel.close({
      tenantId: acme.id,
      countedCashAmount: 50000,
      withdrawnCashAmount: 40000,
      closedById: adminId,
    });

    expect(cerrado.withdrawnCashAmount).toBe(40000);
    expect(cerrado.pettyCashAmount).toBe(10000);
    // El arqueo se firma con lo CONTADO: el retiro pasa después y no mueve la
    // diferencia.
    expect(cerrado.countedCashAmount).toBe(50000);
    expect(cerrado.nextSession.openingAmount).toBe(10000);
  });

  it("llevarse todo deja la caja abierta en cero", async () => {
    await setSchedule(horarioVigente());
    await CashRegisterModel.open({ tenantId: acme.id, openingAmount: 0, openedById: adminId });

    const cerrado = await CashRegisterModel.close({
      tenantId: acme.id,
      countedCashAmount: 7500,
      withdrawnCashAmount: 7500,
      closedById: adminId,
    });

    expect(cerrado.pettyCashAmount).toBe(0);
    expect(cerrado.nextSession.openingAmount).toBe(0);
  });

  it("no se puede retirar más de lo contado", async () => {
    await setSchedule(horarioVigente());
    await CashRegisterModel.open({ tenantId: acme.id, openingAmount: 0, openedById: adminId });

    await expect(
      CashRegisterModel.close({
        tenantId: acme.id,
        countedCashAmount: 1000,
        withdrawnCashAmount: 1200,
        closedById: adminId,
      })
    ).rejects.toMatchObject({
      code: "CASH_WITHDRAWAL_EXCEEDS_COUNT",
      statusCode: 409,
    });

    // Y el turno sigue abierto: el 409 frena antes de firmar nada.
    expect(
      await prisma.cashRegisterSession.count({
        where: { tenantId: acme.id, status: "OPEN" },
      })
    ).toBe(1);
  });

  it("sin declarar retiro arrastra todo, como antes", async () => {
    await setSchedule(horarioVigente());
    await CashRegisterModel.open({ tenantId: acme.id, openingAmount: 0, openedById: adminId });

    const cerrado = await CashRegisterModel.close({
      tenantId: acme.id,
      countedCashAmount: 3200,
      closedById: adminId,
    });

    expect(cerrado.withdrawnCashAmount).toBe(0);
    expect(cerrado.pettyCashAmount).toBe(3200);
    expect(cerrado.nextSession.openingAmount).toBe(3200);
  });

  it("abrir a mano después de un retiro arrastra la caja chica, no lo contado", async () => {
    await setSchedule(null);
    await CashRegisterModel.open({ tenantId: acme.id, openingAmount: 0, openedById: adminId });

    await CashRegisterModel.close({
      tenantId: acme.id,
      countedCashAmount: 9000,
      withdrawnCashAmount: 8000,
      closedById: adminId,
      // Cerrada de verdad: es el caso en que alguien la abre a mano al otro día.
      reopen: false,
    });

    const abierta = await CashRegisterModel.open({
      tenantId: acme.id,
      openedById: adminId,
    });

    expect(abierta.openingAmount).toBe(1000);
  });

  it("un cierre sin conteo no tiene retiro ni caja chica", async () => {
    await setSchedule(horarioVigente());
    const turno = await CashRegisterModel.open({
      tenantId: acme.id,
      openingAmount: 4000,
      openedById: adminId,
    });

    const cerrado = await CashRegisterModel.closeWithoutCount({
      tenantId: acme.id,
      sessionId: turno.id,
      actorId: adminId,
    });

    // Nadie contó y nadie retiró: los dos en null, y el arrastre vuelve al esperado.
    expect(cerrado.withdrawnCashAmount).toBeNull();
    expect(cerrado.pettyCashAmount).toBeNull();

    const abierta = await CashRegisterModel.open({
      tenantId: acme.id,
      openedById: adminId,
    });
    expect(abierta.openingAmount).toBe(4000);
  });
});

describe("validación del horario por HTTP", () => {
  it("acepta los tres turnos del cliente", async () => {
    const res = await request(app)
      .patch(`/tenant-config/${acme.id}`)
      .set("Cookie", cookie)
      .send({
        cashSchedule: [
          { label: "Mañana", from: "08:00", to: "14:00" },
          { label: "Tarde", from: "14:00", to: "20:00" },
          { label: "Noche", from: "20:00", to: "02:00" },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.config.cashSchedule).toHaveLength(3);
  });

  it("rechaza turnos solapados", async () => {
    const res = await request(app)
      .patch(`/tenant-config/${acme.id}`)
      .set("Cookie", cookie)
      .send({
        cashSchedule: [
          { label: "Mañana", from: "08:00", to: "14:00" },
          { label: "Mediodía", from: "13:00", to: "16:00" },
        ],
      });

    expect(res.status).toBe(400);
  });

  it("rechaza una hora que no es HH:MM", async () => {
    const res = await request(app)
      .patch(`/tenant-config/${acme.id}`)
      .set("Cookie", cookie)
      .send({ cashSchedule: [{ label: "Raro", from: "8am", to: "14:00" }] });

    expect(res.status).toBe(400);
  });

  it("null lo apaga: vuelve a la operación 100% manual", async () => {
    const res = await request(app)
      .patch(`/tenant-config/${acme.id}`)
      .set("Cookie", cookie)
      .send({ cashSchedule: null });

    expect(res.status).toBe(200);
    expect(res.body.config.cashSchedule).toBeNull();
  });
});
