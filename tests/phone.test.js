import { describe, it, expect } from "vitest";
import {
  normalizeCustomerPhone,
  normalizeAreaCode,
  normalizeCountryCode,
  formatPhoneDisplay,
} from "../lib/phone.js";

// Tenant de San Juan: país 54, característica 264. Es el caso que motivó todo
// esto, así que casi todos los casos usan estas opciones.
const SJ = { country: "54", area: "264" };

// El mismo número real, escrito de todas las formas en que la gente lo tipea.
const TARGET = "5492644123456";

describe("normalizeCustomerPhone", () => {
  it.each([
    ["4123456", "solo el abonado"],
    ["154123456", "abonado con el 15 de móvil"],
    ["2644123456", "característica + abonado"],
    ["264 4123456", "con espacio"],
    ["264 15 4123456", "con el 15 en el medio"],
    ["0264 15 4123456", "con el 0 nacional y el 15"],
    ["(264) 412-3456", "con paréntesis y guión"],
    ["+54 9 264 412-3456", "ya internacional"],
    ["5492644123456", "internacional pelado"],
    ["00 54 9 264 4123456", "con prefijo de salida 00"],
  ])("%s (%s) → el mismo E.164", (input) => {
    expect(normalizeCustomerPhone(input, SJ)).toBe(TARGET);
  });

  it("agrega el 9 de móvil si vino internacional sin él", () => {
    expect(normalizeCustomerPhone("+54 264 4123456", SJ)).toBe(TARGET);
  });

  it("no duplica el 9 cuando ya está", () => {
    expect(normalizeCustomerPhone("92644123456", SJ)).toBe(TARGET);
  });

  it("respeta una característica distinta a la del tenant", () => {
    // Alguien de Buenos Aires comprando en la tienda de San Juan: su número es
    // válido y no hay que tocarlo más allá del formato.
    expect(normalizeCustomerPhone("11 5555 1234", SJ)).toBe("5491155551234");
  });

  it("sin característica configurada no puede completar un número local", () => {
    expect(normalizeCustomerPhone("4123456", { country: "54" })).toBeNull();
  });

  it("sin característica igual normaliza uno que ya la trae", () => {
    expect(normalizeCustomerPhone("2644123456", { country: "54" })).toBe(TARGET);
  });

  it("no le mete el 9 argentino a otros países", () => {
    expect(normalizeCustomerPhone("+56 9 1234 5678", { country: "56" })).toBe(
      "56912345678"
    );
  });

  it.each([
    [null, "null"],
    [undefined, "undefined"],
    ["", "vacío"],
    ["   ", "espacios"],
    ["no es un teléfono", "letras"],
    ["123", "demasiado corto"],
    ["1".repeat(20), "demasiado largo"],
    [42, "no es string"],
  ])("%s (%s) → null", (input) => {
    expect(normalizeCustomerPhone(input, SJ)).toBeNull();
  });
});

describe("normalizeAreaCode", () => {
  it.each([
    ["264", "264"],
    ["0264", "264"],
    ["(264)", "264"],
    [" 11 ", "11"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeAreaCode(input)).toBe(expected);
  });

  it.each([null, "", "0", "123456", "abc"])("%s → null", (input) => {
    expect(normalizeAreaCode(input)).toBeNull();
  });
});

describe("normalizeCountryCode", () => {
  it("saca el +", () => {
    expect(normalizeCountryCode("+54")).toBe("54");
  });

  it("null si no queda nada", () => {
    expect(normalizeCountryCode("")).toBeNull();
  });
});

describe("formatPhoneDisplay", () => {
  it("agrupa el móvil argentino", () => {
    expect(formatPhoneDisplay(TARGET)).toBe("+54 9 264 412-3456");
  });

  it("agrupa uno de Buenos Aires", () => {
    expect(formatPhoneDisplay("5491155551234")).toBe("+54 9 11 5555-1234");
  });

  it("cae a +dígitos con cualquier otro país", () => {
    expect(formatPhoneDisplay("56912345678")).toBe("+56912345678");
  });

  it("null si no hay dígitos", () => {
    expect(formatPhoneDisplay(null)).toBeNull();
  });
});
