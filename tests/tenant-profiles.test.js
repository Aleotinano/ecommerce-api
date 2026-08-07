import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_TENANT_PROFILE,
  TENANT_PROFILES,
  TENANT_PROFILE_NAMES,
  resolveProfile,
} from "../services/tenant-profiles.js";

// El módulo es puro: no toca DB, así que este archivo corre sin base.

describe("resolveProfile", () => {
  it("devuelve los valores del perfil pedido", () => {
    expect(resolveProfile("contraentrega")).toEqual({
      storeMode: "SHOP",
      paymentMethodsEnabled: ["CASH"],
      fulfillmentMethodsEnabled: ["DELIVERY"],
      depositEnabled: false,
      depositPercentage: 50,
    });
  });

  it("carta es el único que no vende online", () => {
    // El modo es lo que distingue a este perfil: sus métodos de pago y entrega
    // son los de `estandar` a propósito (en MENU no nacen órdenes, así que no
    // gobiernan nada), y si alguien los vaciara buscando "coherencia" rompería
    // el día que el cliente pase a vender.
    const menu = TENANT_PROFILE_NAMES.filter(
      (name) => TENANT_PROFILES[name].storeMode === "MENU"
    );
    expect(menu).toEqual(["carta"]);
    expect(resolveProfile("carta").paymentMethodsEnabled.length).toBeGreaterThan(0);
  });

  it("sin argumento cae al perfil por defecto", () => {
    expect(resolveProfile()).toEqual(TENANT_PROFILES[DEFAULT_TENANT_PROFILE]);
  });

  it("lanza con un nombre inválido en vez de caer al default", () => {
    // Un typo en el script de operación tiene que fallar fuerte: caer al default
    // silenciosamente dejaría al tenant con el flujo de otro negocio.
    try {
      resolveProfile("contra-entrega");
      throw new Error("debería haber lanzado");
    } catch (error) {
      expect(error.code).toBe("TENANT_PROFILE_UNKNOWN");
      expect(error.statusCode).toBe(400);
      expect(error.details.validos).toEqual(TENANT_PROFILE_NAMES);
    }
  });

  it("devuelve una copia: mutarla no contamina el perfil", () => {
    const primero = resolveProfile("contraentrega");
    primero.paymentMethodsEnabled.push("TRANSFER");

    expect(resolveProfile("contraentrega").paymentMethodsEnabled).toEqual(["CASH"]);
  });
});

describe("todos los perfiles", () => {
  it("todos declaran las cinco claves de flujo", () => {
    for (const [name, values] of Object.entries(TENANT_PROFILES)) {
      expect(Object.keys(values).sort(), `perfil ${name}`).toEqual([
        "depositEnabled",
        "depositPercentage",
        "fulfillmentMethodsEnabled",
        "paymentMethodsEnabled",
        "storeMode",
      ]);
      expect(values.paymentMethodsEnabled.length, `perfil ${name}`).toBeGreaterThan(0);
      expect(values.fulfillmentMethodsEnabled.length, `perfil ${name}`).toBeGreaterThan(0);
    }
  });

  it("solo produccion-por-sena exige seña", () => {
    const conSeña = TENANT_PROFILE_NAMES.filter(
      (name) => TENANT_PROFILES[name].depositEnabled
    );
    expect(conSeña).toEqual(["produccion-por-sena"]);
  });
});

// Este es el test que importa a largo plazo: el perfil por defecto y los
// `@default()` del schema Prisma tienen que decir lo mismo. Si se desincronizan, un
// tenant creado por `register` (que aplica el perfil) y otro creado a mano por SQL
// (que cae en los defaults de la columna) se comportarían distinto, y encontrar eso
// después es carísimo.
describe("el perfil por defecto coincide con los @default() de Prisma", () => {
  const schema = readFileSync(
    fileURLToPath(new URL("../prisma/schema.prisma", import.meta.url)),
    "utf8"
  );

  /** Extrae `@default([A, B])` de la línea de un campo del modelo. */
  function defaultList(field) {
    const match = schema.match(
      new RegExp(`${field}\\s+\\w+\\[\\]\\s+@default\\(\\[([^\\]]*)\\]\\)`)
    );
    if (!match) throw new Error(`No encontré el @default() de ${field} en schema.prisma`);
    return match[1]
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }

  /** Extrae `@default(x)` escalar. */
  function defaultScalar(field) {
    const match = schema.match(new RegExp(`${field}\\s+\\w+\\s+@default\\(([^)]*)\\)`));
    if (!match) throw new Error(`No encontré el @default() de ${field} en schema.prisma`);
    return match[1].trim();
  }

  const estandar = TENANT_PROFILES[DEFAULT_TENANT_PROFILE];

  it("paymentMethodsEnabled", () => {
    expect(defaultList("paymentMethodsEnabled")).toEqual(estandar.paymentMethodsEnabled);
  });

  it("fulfillmentMethodsEnabled", () => {
    expect(defaultList("fulfillmentMethodsEnabled")).toEqual(
      estandar.fulfillmentMethodsEnabled
    );
  });

  it("depositEnabled y depositPercentage", () => {
    expect(defaultScalar("depositEnabled")).toBe(String(estandar.depositEnabled));
    expect(Number(defaultScalar("depositPercentage"))).toBe(estandar.depositPercentage);
  });

  it("storeMode", () => {
    // El default de la columna es texto entre comillas en el schema.
    expect(defaultScalar("storeMode").replace(/"/g, "")).toBe(estandar.storeMode);
  });
});
