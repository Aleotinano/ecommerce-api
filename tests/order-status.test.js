import { describe, expect, it } from "vitest";

import {
  ORDER_STATUS_CATALOG,
  ORDER_STATUS_CODES,
  getStatusMeta,
  listPublicStatuses,
} from "../services/order-status.js";
import { ORDER_TRANSITIONS } from "../services/order-state.js";

/**
 * El catálogo es el único lugar donde un estado tiene nombre, así que lo que se
 * testea acá es sobre todo **cobertura**: un estado nuevo en el enum que nadie
 * bautizó tiene que romper el build, no salir en pantalla como "READY".
 *
 * Módulo puro: no toca base ni levanta el server.
 */
describe("catálogo de estados", () => {
  it("cubre exactamente el enum OrderStatus", () => {
    // `ORDER_TRANSITIONS` declara una entrada por estado del enum, así que sirve
    // de contraparte sin tener que repetir la lista acá.
    //
    // Sobre copias: `ORDER_STATUS_CODES` está congelado justamente porque este
    // test lo ordenó in place y dejó "CANCELLED" como primer estado del pipeline
    // para todos los tests que corrieran después.
    expect([...ORDER_STATUS_CODES].sort()).toEqual(
      Object.keys(ORDER_TRANSITIONS).sort()
    );
  });

  it("el primer estado es NEW y abre el pipeline", () => {
    expect(ORDER_STATUS_CODES[0]).toBe("NEW");
    expect(ORDER_STATUS_CATALOG.NEW.position).toBe(0);
  });

  it("NEW no es un destino manual: lo mueve el motor", () => {
    expect(ORDER_STATUS_CATALOG.NEW.isManual).toBe(false);
    // Y ningún estado puede volver a él.
    for (const destinos of Object.values(ORDER_TRANSITIONS)) {
      expect(destinos).not.toContain("NEW");
    }
  });

  it("CANCELLED está fuera del pipeline (es la salida lateral)", () => {
    expect(ORDER_STATUS_CATALOG.CANCELLED.position).toBeNull();
  });

  it("las posiciones del pipeline son consecutivas y sin repetidos", () => {
    const posiciones = ORDER_STATUS_CODES.map(
      (code) => ORDER_STATUS_CATALOG[code].position
    ).filter((p) => p !== null);

    expect(posiciones).toEqual([0, 1, 2, 3]);
  });

  it("cada estado tiene texto para el panel y para el cliente", () => {
    for (const code of ORDER_STATUS_CODES) {
      const meta = ORDER_STATUS_CATALOG[code];
      expect(meta.admin.label, code).toBeTruthy();
      expect(meta.admin.plural, code).toBeTruthy();
      expect(meta.admin.message, code).toBeTruthy();
      expect(meta.customer.label, code).toBeTruthy();
      expect(meta.customer.description, code).toBeTruthy();
      expect(meta.email.status, code).toBeTruthy();
      expect(meta.email.message, code).toBeTruthy();
      expect(meta.historyNote, code).toBeTruthy();
    }
  });

  it("un estado desconocido no rompe: cae al código como texto", () => {
    const meta = getStatusMeta("IN_ORBIT");
    expect(meta.admin.label).toBe("IN_ORBIT");
    expect(meta.historyNote).toContain("IN_ORBIT");
  });
});

describe("proyección pública", () => {
  it("no expone el copy interno (email ni nota de historial)", () => {
    for (const status of listPublicStatuses()) {
      expect(status).not.toHaveProperty("email");
      expect(status).not.toHaveProperty("historyNote");
    }
  });

  it("trae las transiciones del motor, no una copia", () => {
    const nueva = listPublicStatuses().find((s) => s.code === "NEW");
    expect(nueva.transitions).toEqual(ORDER_TRANSITIONS.NEW);
  });

  it("sale en orden de flujo", () => {
    expect(listPublicStatuses().map((s) => s.code)).toEqual([
      "NEW",
      "PROCESSING",
      "READY",
      "COMPLETED",
      "CANCELLED",
    ]);
  });
});
