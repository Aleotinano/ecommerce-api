import { describe, it, expect } from "vitest";
import {
  ANGLE_PREDICATES,
  ANGLE_SELECTORS,
  ANGLE_ORDER,
  LOW_STOCK_THRESHOLD,
  NEW_ARRIVAL_DAYS,
} from "../services/content-suggestions/angles.js";

// Logica pura de Fase 1 (sin DB ni LLM): predicados y selectores por angulo.
// Es la unica fuente de verdad de "que producto destacar y bajo que motivo".

const NOW = new Date("2026-06-20T12:00:00.000Z");
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

/** Producto enriquecido por defecto: activo, recien creado, con stock, sin ventas. */
const product = (over = {}) => ({
  id: 1,
  name: "Producto",
  isActive: true,
  createdAt: NOW,
  units: 0,
  type: "VARIANTE",
  variants: [{ stock: 10, isActive: true }],
  ...over,
});

describe("ANGLE_PREDICATES", () => {
  describe("BEST_SELLER", () => {
    it("aplica a producto activo con unidades vendidas", () => {
      expect(ANGLE_PREDICATES.BEST_SELLER(product({ units: 3 }))).toBe(true);
    });

    it("no aplica sin ventas en la ventana", () => {
      expect(ANGLE_PREDICATES.BEST_SELLER(product({ units: 0 }))).toBe(false);
    });

    it("no aplica si el producto esta inactivo", () => {
      expect(
        ANGLE_PREDICATES.BEST_SELLER(product({ units: 5, isActive: false }))
      ).toBe(false);
    });
  });

  describe("NEW_ARRIVAL", () => {
    it("aplica dentro de la ventana de novedades", () => {
      const recent = product({ createdAt: daysAgo(NEW_ARRIVAL_DAYS - 1) });
      expect(ANGLE_PREDICATES.NEW_ARRIVAL(recent, NOW)).toBe(true);
    });

    it("no aplica si el producto es mas viejo que la ventana", () => {
      const old = product({ createdAt: daysAgo(NEW_ARRIVAL_DAYS + 1) });
      expect(ANGLE_PREDICATES.NEW_ARRIVAL(old, NOW)).toBe(false);
    });

    it("no aplica si esta inactivo aunque sea reciente", () => {
      expect(
        ANGLE_PREDICATES.NEW_ARRIVAL(product({ isActive: false }), NOW)
      ).toBe(false);
    });
  });

  describe("LOW_STOCK", () => {
    it("aplica con stock por encima de 0 y hasta el umbral", () => {
      const low = product({ variants: [{ stock: LOW_STOCK_THRESHOLD, isActive: true }] });
      expect(ANGLE_PREDICATES.LOW_STOCK(low)).toBe(true);
    });

    it("no aplica con stock 0 (agotado)", () => {
      const sold = product({ variants: [{ stock: 0, isActive: true }] });
      expect(ANGLE_PREDICATES.LOW_STOCK(sold)).toBe(false);
    });

    it("no aplica con stock holgado por encima del umbral", () => {
      const plenty = product({ variants: [{ stock: LOW_STOCK_THRESHOLD + 1, isActive: true }] });
      expect(ANGLE_PREDICATES.LOW_STOCK(plenty)).toBe(false);
    });

    it("ignora el stock de variantes inactivas al sumar", () => {
      // 3 activas + 100 inactivas => total considerado = 3 (low stock).
      const mixed = product({
        variants: [
          { stock: 3, isActive: true },
          { stock: 100, isActive: false },
        ],
      });
      expect(ANGLE_PREDICATES.LOW_STOCK(mixed)).toBe(true);
    });
  });

  describe("NO_RECENT_SALES", () => {
    it("aplica con stock disponible y sin ventas", () => {
      expect(ANGLE_PREDICATES.NO_RECENT_SALES(product({ units: 0 }))).toBe(true);
    });

    it("no aplica si hubo ventas en la ventana", () => {
      expect(ANGLE_PREDICATES.NO_RECENT_SALES(product({ units: 1 }))).toBe(false);
    });

    it("no aplica sin stock disponible", () => {
      const sold = product({ units: 0, variants: [{ stock: 0, isActive: true }] });
      expect(ANGLE_PREDICATES.NO_RECENT_SALES(sold)).toBe(false);
    });
  });
});

describe("ANGLE_SELECTORS", () => {
  it("BEST_SELLER elige el de mas unidades vendidas", () => {
    const products = [
      product({ id: 1, units: 2 }),
      product({ id: 2, units: 9 }),
      product({ id: 3, units: 5 }),
    ];
    expect(ANGLE_SELECTORS.BEST_SELLER(products)).toBe(2);
  });

  it("NEW_ARRIVAL elige el createdAt mas reciente entre los recientes", () => {
    const products = [
      product({ id: 1, createdAt: daysAgo(20) }),
      product({ id: 2, createdAt: daysAgo(2) }),
      product({ id: 3, createdAt: daysAgo(10) }),
    ];
    expect(ANGLE_SELECTORS.NEW_ARRIVAL(products, NOW)).toBe(2);
  });

  it("LOW_STOCK elige entre los de stock bajo, desempatando por mas vendido", () => {
    const products = [
      product({ id: 1, units: 1, variants: [{ stock: 2, isActive: true }] }),
      product({ id: 2, units: 4, variants: [{ stock: 3, isActive: true }] }),
      product({ id: 3, units: 0, variants: [{ stock: 50, isActive: true }] }), // holgado
    ];
    expect(ANGLE_SELECTORS.LOW_STOCK(products)).toBe(2);
  });

  it("NO_RECENT_SALES elige el primero del catalogo que califica", () => {
    const products = [
      product({ id: 1, units: 3 }), // tiene ventas, no califica
      product({ id: 2, units: 0 }),
      product({ id: 3, units: 0 }),
    ];
    expect(ANGLE_SELECTORS.NO_RECENT_SALES(products)).toBe(2);
  });

  it("cada selector devuelve null cuando no hay candidato", () => {
    const noneSell = [product({ units: 0 })];
    expect(ANGLE_SELECTORS.BEST_SELLER(noneSell)).toBeNull();

    const allOld = [product({ createdAt: daysAgo(NEW_ARRIVAL_DAYS + 5) })];
    expect(ANGLE_SELECTORS.NEW_ARRIVAL(allOld, NOW)).toBeNull();

    const plenty = [product({ variants: [{ stock: 50, isActive: true }] })];
    expect(ANGLE_SELECTORS.LOW_STOCK(plenty)).toBeNull();

    const allSold = [product({ units: 2 })];
    expect(ANGLE_SELECTORS.NO_RECENT_SALES(allSold)).toBeNull();
  });
});

describe("ANGLE_ORDER", () => {
  it("hay un selector y un predicado por cada angulo de la rotacion", () => {
    for (const angle of ANGLE_ORDER) {
      expect(typeof ANGLE_SELECTORS[angle]).toBe("function");
      expect(typeof ANGLE_PREDICATES[angle]).toBe("function");
    }
  });
});
