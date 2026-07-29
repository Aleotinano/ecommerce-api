import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  CASH_MOVEMENT_SIGN,
  MANUAL_MOVEMENT_TYPES,
  buildArqueo,
  signedAmount,
  summarizeMovements,
} from "../services/cash-register-math.js";

// El módulo es puro: no toca DB, así que este archivo corre sin base.

const mov = (type, amount, extra = {}) => ({
  type,
  amount,
  channel: "CASH",
  categoryId: null,
  ...extra,
});

describe("signedAmount", () => {
  it("los ingresos suman y los egresos restan", () => {
    expect(signedAmount(mov("INCOME", 1000))).toBe(1000);
    expect(signedAmount(mov("EXPENSE", 1000))).toBe(-1000);
    expect(signedAmount(mov("ORDER_PAYMENT", 250.5))).toBe(250.5);
    expect(signedAmount(mov("ORDER_REFUND", 250.5))).toBe(-250.5);
  });

  it("un tipo sin signo definido lanza en vez de asumir que suma", () => {
    // Asumir "+1" acá es plata inventada que nadie descubre hasta el arqueo.
    try {
      signedAmount(mov("ORDER_ADJUSTMENT", 100));
      throw new Error("debería haber lanzado");
    } catch (error) {
      expect(error.code).toBe("CASH_MOVEMENT_TYPE_UNKNOWN");
    }
  });
});

describe("summarizeMovements", () => {
  it("solo el efectivo mueve el cajón; la transferencia va aparte", () => {
    const resumen = summarizeMovements([
      mov("INCOME", 1000),
      mov("ORDER_PAYMENT", 5000, { channel: "TRANSFER" }),
      mov("EXPENSE", 400),
    ]);

    expect(resumen.cashNet).toBe(600);
    expect(resumen.transferTotal).toBe(5000);
    expect(resumen.count).toBe(3);
  });

  it("agrupa por tipo con signo", () => {
    const resumen = summarizeMovements([
      mov("ORDER_PAYMENT", 1000),
      mov("ORDER_PAYMENT", 500),
      mov("ORDER_REFUND", 300),
    ]);

    expect(resumen.byType).toEqual({ ORDER_PAYMENT: 1500, ORDER_REFUND: -300 });
  });

  it("agrupa por etiqueta y deja afuera los movimientos de órdenes", () => {
    const sueldos = { categoryId: 1, category: { key: "sueldos", label: "Sueldos" } };
    const insumos = { categoryId: 2, category: { key: "insumos", label: "Insumos" } };

    const resumen = summarizeMovements([
      mov("EXPENSE", 20000, sueldos),
      mov("EXPENSE", 5000, sueldos),
      mov("EXPENSE", 3000, insumos),
      // Los ORDER_* no tienen etiqueta: se leen en byType, no acá.
      mov("ORDER_PAYMENT", 9000),
    ]);

    expect(resumen.byCategory.sueldos).toEqual({
      categoryId: 1,
      label: "Sueldos",
      total: -25000,
      count: 2,
    });
    expect(resumen.byCategory.insumos.total).toBe(-3000);
    expect(Object.keys(resumen.byCategory)).toEqual(["sueldos", "insumos"]);
  });

  it("una lista vacía no rompe", () => {
    expect(summarizeMovements()).toMatchObject({ cashNet: 0, transferTotal: 0, count: 0 });
  });
});

describe("buildArqueo", () => {
  it("esperado = apertura + movimientos en efectivo, y la diferencia es contado − esperado", () => {
    const arqueo = buildArqueo({
      openingAmount: 5000,
      movements: [mov("INCOME", 1000), mov("EXPENSE", 2000)],
      countedCashAmount: 3900,
    });

    expect(arqueo.expectedCashAmount).toBe(4000);
    expect(arqueo.countedCashAmount).toBe(3900);
    // Negativo = falta plata en el cajón.
    expect(arqueo.cashDifference).toBe(-100);
  });

  it("una transferencia no cambia el efectivo esperado", () => {
    const arqueo = buildArqueo({
      openingAmount: 1000,
      movements: [mov("ORDER_PAYMENT", 8000, { channel: "TRANSFER" })],
      countedCashAmount: 1000,
    });

    expect(arqueo.expectedCashAmount).toBe(1000);
    expect(arqueo.cashDifference).toBe(0);
    expect(arqueo.transferTotal).toBe(8000);
  });

  it("sin conteo (turno abierto) devuelve el esperado y la diferencia en null", () => {
    const arqueo = buildArqueo({ openingAmount: 500, movements: [mov("INCOME", 100)] });

    expect(arqueo.expectedCashAmount).toBe(600);
    expect(arqueo.countedCashAmount).toBeNull();
    expect(arqueo.cashDifference).toBeNull();
  });

  it("redondea a dos decimales en vez de arrastrar el error de Float", () => {
    const arqueo = buildArqueo({
      openingAmount: 0,
      movements: [mov("INCOME", 0.1), mov("INCOME", 0.2)],
      countedCashAmount: 0.3,
    });

    expect(arqueo.expectedCashAmount).toBe(0.3);
    expect(arqueo.cashDifference).toBe(0);
  });
});

// El test que importa a largo plazo: si mañana se agrega un tipo de movimiento al
// enum y nadie le define el signo, el arqueo empieza a mentir. Que falle acá.
describe("CASH_MOVEMENT_SIGN cubre todo el enum de Prisma", () => {
  it("mismos valores que CashMovementType en schema.prisma", () => {
    const schema = readFileSync(
      fileURLToPath(new URL("../prisma/schema.prisma", import.meta.url)),
      "utf8"
    );

    const block = schema.match(/enum CashMovementType \{([^}]*)\}/);
    expect(block, "no encontré el enum CashMovementType").toBeTruthy();

    const values = block[1]
      .split("\n")
      // `split("//")` y no un regex con `$`: el archivo tiene CRLF y `.` no cruza
      // el `\r`, así que el comentario quedaba pegado al valor.
      .map((line) => line.split("//")[0].trim())
      .filter(Boolean);

    expect(values.sort()).toEqual(Object.keys(CASH_MOVEMENT_SIGN).sort());
  });

  it("los tipos manuales son un subconjunto del enum", () => {
    for (const type of MANUAL_MOVEMENT_TYPES) {
      expect(CASH_MOVEMENT_SIGN[type]).toBeDefined();
    }
  });
});
