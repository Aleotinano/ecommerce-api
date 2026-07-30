import { describe, it, expect } from "vitest";

import {
  AUTO_CLOSE_GRACE_MINUTES,
  expiredByMinutes,
  findScheduleOverlap,
  isExpired,
  parseSchedule,
  shiftExpiry,
  shiftFor,
  shouldAutoClose,
  toMinutes,
} from "../services/cash-register-schedule.js";

// Módulo puro: corre sin base.

// Mañana, tarde y noche — el horario real del cliente. El de la noche cruza la
// medianoche, que es el caso que rompe cualquier implementación ingenua.
const TURNOS = [
  { label: "Mañana", from: "08:00", to: "14:00" },
  { label: "Tarde", from: "14:00", to: "20:00" },
  { label: "Noche", from: "20:00", to: "02:00" },
];

/** Un Date local a la hora indicada del 2026-07-30 (jueves). */
const at = (hh, mm = 0, day = 30) => new Date(2026, 6, day, hh, mm, 0, 0);

describe("toMinutes", () => {
  it("acepta HH:MM de 24 horas", () => {
    expect(toMinutes("00:00")).toBe(0);
    expect(toMinutes("08:30")).toBe(510);
    expect(toMinutes("23:59")).toBe(1439);
  });

  it("rechaza cualquier otra cosa", () => {
    for (const value of ["24:00", "8:00", "08:60", "ocho", "", null, undefined, "08:00:00"]) {
      expect(toMinutes(value), String(value)).toBeNull();
    }
  });
});

describe("parseSchedule", () => {
  it("marca como overnight el turno que cruza la medianoche", () => {
    const [manana, , noche] = parseSchedule(TURNOS);

    expect(manana.overnight).toBe(false);
    expect(noche.overnight).toBe(true);
    expect(noche.from).toBe(1200);
    expect(noche.to).toBe(120);
  });

  it("descarta turnos sin forma en vez de lanzar", () => {
    // Un horario corrupto no puede impedir cobrar: la validación fuerte está en Zod.
    const shifts = parseSchedule([
      { label: "Ok", from: "09:00", to: "13:00" },
      { label: "Sin hora", from: "nueve", to: "13:00" },
      { label: "Cero minutos", from: "10:00", to: "10:00" },
      "basura",
      null,
    ]);

    expect(shifts.map((s) => s.label)).toEqual(["Ok"]);
  });

  it("un horario ausente es una lista vacía, no un error", () => {
    expect(parseSchedule(null)).toEqual([]);
    expect(parseSchedule(undefined)).toEqual([]);
    expect(parseSchedule({})).toEqual([]);
  });

  it("le pone nombre al turno que no lo trae", () => {
    expect(parseSchedule([{ from: "08:00", to: "14:00" }])[0].label).toBe("Turno 1");
  });
});

describe("findScheduleOverlap", () => {
  it("los tres turnos del cliente no se solapan", () => {
    expect(findScheduleOverlap(parseSchedule(TURNOS))).toBeNull();
  });

  it("detecta el solape simple", () => {
    const overlap = findScheduleOverlap(
      parseSchedule([
        { label: "Mañana", from: "08:00", to: "14:00" },
        { label: "Mediodía", from: "13:00", to: "16:00" },
      ])
    );

    expect(overlap).toEqual({ a: "Mañana", b: "Mediodía" });
  });

  it("detecta el solape del turno nocturno con el de la mañana siguiente", () => {
    // 22:00–07:00 pisa 06:00–12:00 del otro lado de la medianoche: es el caso que se
    // escapa si el turno nocturno no se trata como dos tramos.
    const overlap = findScheduleOverlap(
      parseSchedule([
        { label: "Noche", from: "22:00", to: "07:00" },
        { label: "Mañana", from: "06:00", to: "12:00" },
      ])
    );

    expect(overlap).toEqual({ a: "Noche", b: "Mañana" });
  });

  it("dos turnos contiguos NO se solapan", () => {
    // 14:00 pertenece a la tarde, no a las dos: el fin es exclusivo.
    expect(
      findScheduleOverlap(
        parseSchedule([
          { label: "Mañana", from: "08:00", to: "14:00" },
          { label: "Tarde", from: "14:00", to: "20:00" },
        ])
      )
    ).toBeNull();
  });
});

describe("shiftFor", () => {
  it("resuelve el turno de cada momento del día", () => {
    expect(shiftFor(at(9), TURNOS).label).toBe("Mañana");
    expect(shiftFor(at(14), TURNOS).label).toBe("Tarde");
    expect(shiftFor(at(19, 59), TURNOS).label).toBe("Tarde");
    expect(shiftFor(at(20), TURNOS).label).toBe("Noche");
    expect(shiftFor(at(23, 30), TURNOS).label).toBe("Noche");
    // Después de medianoche seguimos en el turno noche.
    expect(shiftFor(at(1), TURNOS).label).toBe("Noche");
  });

  it("fuera de horario devuelve null", () => {
    expect(shiftFor(at(3), TURNOS)).toBeNull();
    expect(shiftFor(at(7, 59), TURNOS)).toBeNull();
  });

  it("sin horario cargado no hay turno", () => {
    expect(shiftFor(at(10), null)).toBeNull();
    expect(shiftFor(at(10), [])).toBeNull();
  });
});

describe("shiftExpiry", () => {
  it("un turno normal vence el mismo día", () => {
    const vence = shiftExpiry(at(9), parseSchedule(TURNOS)[0]);

    expect(vence.getDate()).toBe(30);
    expect(vence.getHours()).toBe(14);
    expect(vence.getMinutes()).toBe(0);
  });

  it("el turno noche abierto a las 21 vence a las 02 del día siguiente", () => {
    const vence = shiftExpiry(at(21), parseSchedule(TURNOS)[2]);

    expect(vence.getDate()).toBe(31);
    expect(vence.getHours()).toBe(2);
  });

  it("el turno noche visto a la 01 vence a las 02 de HOY, no de mañana", () => {
    const vence = shiftExpiry(at(1), parseSchedule(TURNOS)[2]);

    expect(vence.getDate()).toBe(30);
    expect(vence.getHours()).toBe(2);
  });
});

describe("vencimiento", () => {
  const abierto = (expiresAt, label = "Mañana") => ({
    status: "OPEN",
    label,
    expiresAt,
  });

  it("un turno en horario no está vencido", () => {
    expect(isExpired(abierto(at(14)), at(12))).toBe(false);
  });

  it("un turno pasado su hora está vencido, con los minutos de atraso", () => {
    expect(isExpired(abierto(at(14)), at(15))).toBe(true);
    expect(expiredByMinutes(abierto(at(14)), at(15, 30))).toBe(90);
  });

  it("un turno sin vencimiento (manual, sin horario) nunca vence", () => {
    expect(isExpired(abierto(null), at(23))).toBe(false);
  });

  it("un turno ya cerrado no vence", () => {
    expect(isExpired({ status: "CLOSED", expiresAt: at(14) }, at(20))).toBe(false);
  });
});

describe("shouldAutoClose", () => {
  const manana = { status: "OPEN", label: "Mañana", expiresAt: at(14) };

  it("no cierra dentro de la gracia, aunque ya haya vencido", () => {
    // Alguien está contando la plata a las 14:30: no se le arranca el turno.
    expect(shouldAutoClose(manana, { now: at(14, 30), schedule: TURNOS })).toBe(false);
    expect(AUTO_CLOSE_GRACE_MINUTES).toBe(60);
  });

  it("cierra cuando pasó la gracia y el turno actual es otro", () => {
    expect(shouldAutoClose(manana, { now: at(15, 30), schedule: TURNOS })).toBe(true);
  });

  it("NO cierra fuera de horario, aunque haya vencido hace horas", () => {
    // A las 04:00 no hay turno que abrir: lo correcto es dejarlo abierto y que el
    // panel lo muestre vencido, no cerrarlo a ciegas.
    expect(shouldAutoClose(manana, { now: at(4, 0, 31), schedule: TURNOS })).toBe(false);
  });

  it("no cierra un turno que sigue siendo el actual", () => {
    // Vencimiento raro (horario editado) pero el turno de ahora es el mismo: no hay
    // nada que reemplazarlo.
    const noche = { status: "OPEN", label: "Noche", expiresAt: at(20, 30) };
    expect(shouldAutoClose(noche, { now: at(23), schedule: TURNOS })).toBe(false);
  });

  it("no cierra un turno sin vencimiento", () => {
    expect(
      shouldAutoClose({ status: "OPEN", label: null, expiresAt: null }, { now: at(23), schedule: TURNOS })
    ).toBe(false);
  });
});
