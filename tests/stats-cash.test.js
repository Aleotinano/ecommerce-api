import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

const prisma = (await import("../lib/prisma.js")).default;
const { app } = await import("../app.js");
const { OrderModel } = await import("../services/orders.js");
const { CartModel } = await import("../services/cart.js");
const { CashRegisterModel } = await import("../services/cash-register.js");
const { seedTenants, seedTenantConfig, cookieFor } = await import("./helpers.js");

// El cruce del dashboard con el libro de cobros y con la caja: facturado vs
// cobrado, por qué vía entró, y qué salió del local.

let acme;
let shopco;
let cookie;
let shopcoCookie;
let variant;
let adminId;
let customerId;

const dashboard = (auth = cookie) =>
  request(app).get("/stats/dashboard").set("Cookie", auth);

async function checkout(fulfillment) {
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
  ({ acme, shopco } = await seedTenants());
  await seedTenantConfig(acme.id, { cashRegisterEnabled: true });
  await seedTenantConfig(shopco.id, { storeName: "ShopCo" });
  await CashRegisterModel.ensureDefaultCategories({ tenantId: acme.id });

  variant = await prisma.productVariant.findFirst({ where: { tenantId: acme.id } });
  adminId = acme.users.find((u) => u.role === "ADMIN").id;
  customerId = acme.users.find((u) => u.role === "CUSTOMER").id;

  cookie = cookieFor(acme.users.find((u) => u.role === "ADMIN"));
  shopcoCookie = cookieFor(shopco.users.find((u) => u.role === "ADMIN"));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("facturado vs cobrado", () => {
  it("una orden entregada y cobrada: facturado == cobrado, sin brecha", async () => {
    await CashRegisterModel.open({ tenantId: acme.id, openingAmount: 0, openedById: adminId });

    const order = await checkout({ paymentMethod: "CASH" });
    await OrderModel.updateOrderStatus({
      tenantId: acme.id,
      orderId: order.id,
      status: "COMPLETED",
      changedById: adminId,
    });

    const res = await dashboard();

    expect(res.status).toBe(200);
    expect(res.body.dashboard.cobranzas.facturado).toBe(order.total);
    expect(res.body.dashboard.cobranzas.cobrado).toBe(order.total);
    expect(res.body.dashboard.cobranzas.brecha).toBe(0);
    expect(res.body.dashboard.cobranzas.porVia.CASH).toBe(order.total);
  });

  it("una seña sin entregar deja la brecha NEGATIVA: entró plata de algo que no salió", async () => {
    await seedTenantConfig(acme.id, {
      cashRegisterEnabled: true,
      depositEnabled: true,
      depositPercentage: 50,
    });

    const antes = (await dashboard()).body.dashboard.cobranzas;
    const order = await checkout({ paymentMethod: "CASH" });

    await OrderModel.confirmDeposit({
      tenantId: acme.id,
      orderId: order.id,
      confirmedById: adminId,
    });

    const despues = (await dashboard()).body.dashboard.cobranzas;

    // La orden no se completó: no facturó nada, pero su seña entró.
    expect(despues.facturado).toBe(antes.facturado);
    expect(despues.cobrado).toBe(antes.cobrado + order.depositAmount);
    expect(despues.brecha).toBeLessThan(antes.brecha);

    await seedTenantConfig(acme.id, { cashRegisterEnabled: true, depositEnabled: false });
  });

  it("distingue por vía y cuenta MercadoPago aparte del mostrador", async () => {
    const order = await checkout({ paymentMethod: "TRANSFER" });

    await OrderModel.registerPayment({
      tenantId: acme.id,
      orderId: order.id,
      kind: "PAYMENT",
      channel: "GATEWAY",
      amount: order.total,
      note: "MercadoPago 999",
    });

    const { porVia } = (await dashboard()).body.dashboard.cobranzas;

    expect(porVia.GATEWAY).toBe(order.total);
    // Y esa plata no tocó la caja: no pasa por el cajón.
    const movimientos = await prisma.cashMovement.count({ where: { orderId: order.id } });
    expect(movimientos).toBe(0);
  });

  it("las devoluciones se restan del cobrado y se informan aparte", async () => {
    const antes = (await dashboard()).body.dashboard.cobranzas;

    const order = await checkout({ paymentMethod: "CASH" });
    await OrderModel.confirmPayment({
      tenantId: acme.id,
      orderId: order.id,
      confirmedById: adminId,
    });
    await OrderModel.registerPayment({
      tenantId: acme.id,
      orderId: order.id,
      kind: "REFUND",
      channel: "CASH",
      amount: 500,
      actorId: adminId,
    });

    const despues = (await dashboard()).body.dashboard.cobranzas;

    expect(despues.cobrado).toBe(antes.cobrado + order.total - 500);
    expect(despues.devuelto).toBe(antes.devuelto + 500);
  });

  it("el KPI `collected` viaja con comparación de período", async () => {
    const { collected } = (await dashboard()).body.dashboard.kpis;

    expect(collected.current).toBeGreaterThan(0);
    expect(collected).toHaveProperty("previous");
    expect(collected).toHaveProperty("changePct");
  });
});

describe("panel de caja", () => {
  it("suma los egresos del local por etiqueta", async () => {
    const insumos = await prisma.cashCategory.findFirst({
      where: { tenantId: acme.id, key: "insumos" },
    });
    const sueldos = await prisma.cashCategory.findFirst({
      where: { tenantId: acme.id, key: "sueldos" },
    });

    // Montos por debajo de lo cobrado en los tests de arriba: si los egresos
    // superaran el efectivo del turno, el esperado quedaría negativo y el arqueo del
    // test siguiente no tendría sentido (ver la deuda de "egreso mayor al efectivo"
    // en la doc de Caja).
    for (const [categoryId, amount] of [
      [sueldos.id, 2000],
      [insumos.id, 300],
      [insumos.id, 150],
    ]) {
      await CashRegisterModel.addMovement({
        tenantId: acme.id,
        type: "EXPENSE",
        channel: "CASH",
        amount,
        categoryId,
        createdById: adminId,
      });
    }

    const { caja, cobranzas } = (await dashboard()).body.dashboard;

    // Por clave y no por índice: la lista está ordenada por peso y las devoluciones
    // de los tests de arriba también son egresos etiquetados.
    const porClave = new Map(caja.egresosPorEtiqueta.map((e) => [e.key, e]));

    expect(porClave.get("sueldos")).toMatchObject({ total: -2000, count: 1 });
    expect(porClave.get("insumos")).toMatchObject({ total: -450, count: 2 });
    // El primero de la lista es en qué se va MÁS plata.
    expect(caja.egresosPorEtiqueta[0].key).toBe("sueldos");
    // Y en esta lista no hay ingresos, aunque ahora las ventas tengan etiqueta.
    for (const bucket of caja.egresosPorEtiqueta) {
      expect(bucket.total, bucket.key).toBeLessThan(0);
    }

    // `porEtiqueta` sí cubre todo, ventas incluidas.
    const todas = new Map(caja.porEtiqueta.map((e) => [e.key, e]));
    expect(todas.get("venta").total).toBeGreaterThan(0);

    expect(caja.resultadoAproximado).toBeCloseTo(cobranzas.cobrado + caja.egresos, 2);
  });

  it("acumula las diferencias de arqueo y cuenta los turnos del día", async () => {
    // Cierra el turno con faltante y abre otro: tres turnos en un día (mañana,
    // tarde, noche) es la operación normal del cliente, no un error.
    const abierto = await CashRegisterModel.getCurrent({ tenantId: acme.id });
    await CashRegisterModel.close({
      tenantId: acme.id,
      countedCashAmount: abierto.totals.expectedCashAmount - 100,
      closedById: adminId,
    });

    await CashRegisterModel.open({ tenantId: acme.id, openingAmount: 0, openedById: adminId });
    await CashRegisterModel.close({
      tenantId: acme.id,
      countedCashAmount: 0,
      closedById: adminId,
    });

    await CashRegisterModel.open({ tenantId: acme.id, openingAmount: 0, openedById: adminId });

    const { caja } = (await dashboard()).body.dashboard;

    expect(caja.turnos).toBe(3);
    expect(caja.turnosCerrados).toBe(2);
    expect(caja.turnoAbierto).toBe(true);
    expect(caja.diferenciaAcumulada).toBe(-100);
    expect(caja.turnosConDiferencia).toBe(1);
  });

  it("un tenant sin caja recibe `caja: null`, no un panel en cero", async () => {
    // Cero egresos por no llevar caja no es lo mismo que cero egresos.
    const res = await dashboard(shopcoCookie);

    expect(res.status).toBe(200);
    expect(res.body.dashboard.caja).toBeNull();
    // Las cobranzas sí existen sin caja: salen del libro de cobros.
    expect(res.body.dashboard.cobranzas).toHaveProperty("brecha");
  });

  it("declara en qué ventana se cuenta cada cosa", async () => {
    const { criteria } = (await dashboard()).body.dashboard.meta;

    expect(criteria.collectedBasedOn).toBe("PAYMENT_CONFIRMED_AT");
    expect(criteria.cashBasedOn).toBe("SESSION_OPENED_AT");
  });
});
