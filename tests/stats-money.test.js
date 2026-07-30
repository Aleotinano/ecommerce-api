import { describe, it, expect } from "vitest";

import {
  buildCashPanel,
  buildCollectionsPanel,
  summarizePayments,
} from "../services/stats/money.js";

// Módulo puro: corre sin base.

const pago = (kind, channel, amount) => ({ kind, channel, amount });
const mov = (type, amount, extra = {}) => ({
  type,
  amount,
  channel: "CASH",
  categoryId: null,
  ...extra,
});
const turno = (status, cashDifference, movements = []) => ({
  status,
  cashDifference,
  movements,
});

describe("summarizePayments", () => {
  it("netea las devoluciones y desglosa por vía", () => {
    const resumen = summarizePayments([
      pago("PAYMENT", "CASH", 10000),
      pago("DEPOSIT", "TRANSFER", 5000),
      pago("PAYMENT", "GATEWAY", 8000),
      pago("REFUND", "CASH", 2000),
    ]);

    expect(resumen.cobrado).toBe(21000);
    expect(resumen.devuelto).toBe(2000);
    // `cobros` cuenta los cobros, no las devoluciones.
    expect(resumen.cobros).toBe(3);
    expect(resumen.porVia).toEqual({ CASH: 8000, TRANSFER: 5000, GATEWAY: 8000 });
  });

  it("sin filas da todo en cero", () => {
    expect(summarizePayments()).toEqual({
      cobrado: 0,
      devuelto: 0,
      cobros: 0,
      porVia: { CASH: 0, TRANSFER: 0, GATEWAY: 0 },
    });
  });
});

describe("buildCollectionsPanel", () => {
  it("la brecha es lo entregado que todavía no se cobró", () => {
    // Dos órdenes de 10000 completadas, una cobrada: se entregó el doble de lo que
    // entró. Es el caso "la transferencia nunca se confirmó".
    const panel = buildCollectionsPanel({
      facturado: 20000,
      payments: [pago("PAYMENT", "CASH", 10000)],
    });

    expect(panel.facturado).toBe(20000);
    expect(panel.cobrado).toBe(10000);
    expect(panel.brecha).toBe(10000);
  });

  it("la brecha es negativa cuando se cobró más de lo entregado", () => {
    // Señas de pedidos que todavía no salieron: lo normal en producción a pedido.
    const panel = buildCollectionsPanel({
      facturado: 0,
      payments: [pago("DEPOSIT", "TRANSFER", 7500)],
    });

    expect(panel.brecha).toBe(-7500);
  });

  it("compara contra el período anterior", () => {
    const panel = buildCollectionsPanel({
      facturado: 1000,
      payments: [pago("PAYMENT", "CASH", 1000)],
      previousPayments: [pago("PAYMENT", "CASH", 400)],
    });

    expect(panel.cobrado).toBe(1000);
    expect(panel.cobradoPrevio).toBe(400);
  });
});

describe("buildCashPanel", () => {
  const sueldos = { categoryId: 1, category: { key: "sueldos", label: "Sueldos" } };
  const insumos = { categoryId: 2, category: { key: "insumos", label: "Insumos" } };

  it("suma los egresos del local y los ordena por peso", () => {
    const panel = buildCashPanel({
      cobrado: 100000,
      sessions: [
        turno("CLOSED", -100, [
          mov("EXPENSE", 20000, sueldos),
          mov("EXPENSE", 3000, insumos),
          mov("ORDER_PAYMENT", 50000),
        ]),
        turno("CLOSED", 0, [mov("EXPENSE", 5000, insumos), mov("INCOME", 1000)]),
      ],
    });

    expect(panel.egresos).toBe(-28000);
    expect(panel.ingresosManuales).toBe(1000);
    // Primero en qué se va más plata.
    expect(panel.egresosPorEtiqueta.map((e) => [e.key, e.total])).toEqual([
      ["sueldos", -20000],
      ["insumos", -8000],
    ]);
    // 100000 cobrado − 28000 de egresos + 1000 de ingreso manual.
    expect(panel.resultadoAproximado).toBe(73000);
  });

  it("acumula las diferencias de arqueo de los turnos cerrados", () => {
    const panel = buildCashPanel({
      sessions: [
        turno("CLOSED", -100),
        turno("CLOSED", -250),
        turno("CLOSED", 0),
        // El turno abierto no tiene arqueo: no puede sumar a la diferencia.
        turno("OPEN", null),
      ],
    });

    expect(panel.turnos).toBe(4);
    expect(panel.turnosCerrados).toBe(3);
    expect(panel.turnoAbierto).toBe(true);
    expect(panel.diferenciaAcumulada).toBe(-350);
    expect(panel.turnosConDiferencia).toBe(2);
  });

  it("tres turnos en el mismo día son lo normal, no un error", () => {
    // Mañana, tarde y noche: la unidad es el turno, no el día. El de la noche cierra
    // después de medianoche y sus movimientos entran igual en él.
    const panel = buildCashPanel({
      sessions: [
        turno("CLOSED", 0, [mov("EXPENSE", 1000, insumos)]),
        turno("CLOSED", 0, [mov("EXPENSE", 2000, insumos)]),
        turno("CLOSED", -50, [mov("EXPENSE", 3000, insumos)]),
      ],
    });

    expect(panel.turnos).toBe(3);
    expect(panel.egresos).toBe(-6000);
  });

  it("sin turnos no rompe", () => {
    const panel = buildCashPanel({ cobrado: 500 });

    expect(panel.turnos).toBe(0);
    expect(panel.egresos).toBe(0);
    expect(panel.egresosPorEtiqueta).toEqual([]);
    expect(panel.resultadoAproximado).toBe(500);
  });
});
