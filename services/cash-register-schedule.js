import { createError } from "../helpers/error.js";

/**
 * Horarios de turno de caja: qué turno corresponde a este momento y cuándo vence.
 *
 * Puro y sin DB, como el resto de la aritmética de la caja. Acá vive la única
 * definición de "¿estamos en horario?", y la usan tanto el service (para abrir el
 * turno solo) como el schema de Zod (para rechazar un horario incoherente antes de
 * guardarlo).
 *
 * **No hay scheduler en el proyecto** (ni `node-cron` ni `setInterval`) y esto no
 * agrega uno: la apertura se resuelve *just-in-time*, cuando llega un cobro o el
 * panel pide el turno actual — mismo criterio que la sugerencia diaria de contenido
 * (`ContentSuggestionModel.getToday`). Un job perdido en el módulo del dinero es
 * peor que no tener job: así no hay nada que se pueda "no ejecutar".
 */

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MINUTES_IN_DAY = 24 * 60;

export const MAX_SHIFTS = 6;

/**
 * Cuánto se le perdona a un turno vencido antes de que el sistema lo cierre sin
 * conteo. Existe para no arrancarle el turno de las manos a quien está contando la
 * plata a las 20:05: el cierre lo sigue haciendo una persona salvo que se olvide.
 * Constante y no configuración: si algún cliente pide otro número, ahí se discute.
 */
export const AUTO_CLOSE_GRACE_MINUTES = 60;

/** "HH:MM" → minutos desde la medianoche. `null` si no tiene el formato. */
export function toMinutes(value) {
  const match = HHMM.exec(String(value ?? "").trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Normaliza el JSON del tenant a turnos usables. Descarta lo que no tenga forma en
 * vez de lanzar: un horario corrupto no puede impedir cobrar (la apertura
 * automática solo DESBLOQUEA), y la validación fuerte está en Zod al escribir.
 */
export function parseSchedule(raw) {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((shift, index) => {
      const from = toMinutes(shift?.from);
      const to = toMinutes(shift?.to);
      if (from === null || to === null || from === to) return null;

      return {
        label: typeof shift?.label === "string" && shift.label.trim() ? shift.label.trim() : `Turno ${index + 1}`,
        from,
        to,
        // 20:00 → 02:00: el turno noche cruza la medianoche. No se parte en dos
        // turnos: es uno, y termina al día siguiente.
        overnight: to < from,
      };
    })
    .filter(Boolean)
    .slice(0, MAX_SHIFTS);
}

/** Los tramos [desde, hasta) que un turno ocupa dentro de un día de 24 h. */
function spans(shift) {
  return shift.overnight
    ? [
        [shift.from, MINUTES_IN_DAY],
        [0, shift.to],
      ]
    : [[shift.from, shift.to]];
}

/**
 * Dos turnos que se pisan hacen ambigua la pregunta "¿en qué turno estamos?".
 * Se rechaza al guardar en vez de resolverlo con una regla arbitraria.
 *
 * @returns {{a: string, b: string}|null} las etiquetas que se solapan
 */
export function findScheduleOverlap(shifts) {
  for (let i = 0; i < shifts.length; i += 1) {
    for (let j = i + 1; j < shifts.length; j += 1) {
      for (const [aStart, aEnd] of spans(shifts[i])) {
        for (const [bStart, bEnd] of spans(shifts[j])) {
          if (aStart < bEnd && bStart < aEnd) {
            return { a: shifts[i].label, b: shifts[j].label };
          }
        }
      }
    }
  }

  return null;
}

/** Minutos desde la medianoche LOCAL del server (el huso donde opera el negocio). */
function minutesOfDay(date) {
  return date.getHours() * 60 + date.getMinutes();
}

/** El turno que contiene a `now`, o `null` si estamos fuera de horario. */
export function shiftFor(now, schedule) {
  const shifts = parseSchedule(schedule);
  const minute = minutesOfDay(now);

  return (
    shifts.find((shift) =>
      spans(shift).some(([start, end]) => minute >= start && minute < end)
    ) ?? null
  );
}

/**
 * Cuándo termina el turno que contiene a `now`. Para un turno que cruza la
 * medianoche, el fin cae al día siguiente **salvo** que ya estemos del otro lado de
 * la medianoche (a la 01:00 del turno 20–02, el fin es a las 02:00 de hoy).
 */
export function shiftExpiry(now, shift) {
  const end = new Date(now);
  end.setHours(0, shift.to, 0, 0);

  if (shift.overnight && minutesOfDay(now) >= shift.from) {
    end.setDate(end.getDate() + 1);
  } else if (!shift.overnight && shift.to <= minutesOfDay(now)) {
    // Defensivo: no debería pasar (shiftFor ya garantiza que estamos dentro).
    end.setDate(end.getDate() + 1);
  }

  return end;
}

/**
 * Un turno abierto pasado su vencimiento. **No es un estado**: se calcula, así no
 * hace falta un job que lo escriba ni queda desincronizado.
 */
export function isExpired(session, now = new Date()) {
  if (!session || session.status !== "OPEN" || !session.expiresAt) return false;
  return new Date(session.expiresAt).getTime() < now.getTime();
}

/** Minutos de atraso de un turno vencido; 0 si está en horario. */
export function expiredByMinutes(session, now = new Date()) {
  if (!isExpired(session, now)) return 0;
  const diff = now.getTime() - new Date(session.expiresAt).getTime();
  return Math.floor(diff / 60_000);
}

/**
 * Si al sistema le corresponde cerrar este turno sin conteo: venció, ya pasó la
 * gracia, **y** el turno que corresponde ahora es otro. Sin esa última condición se
 * cerraría un turno solo por terminar el horario, aunque nadie fuera a abrir otro —
 * y ahí lo correcto es dejarlo abierto y avisar.
 */
export function shouldAutoClose(session, { now = new Date(), schedule } = {}) {
  if (expiredByMinutes(session, now) <= AUTO_CLOSE_GRACE_MINUTES) return false;

  const actual = shiftFor(now, schedule);
  if (!actual) return false;

  return actual.label !== session.label;
}

/** Valida un horario ya normalizado; lanza con detalle para el PATCH de config. */
export function assertValidSchedule(raw) {
  const shifts = parseSchedule(raw);
  const overlap = findScheduleOverlap(shifts);

  if (overlap) {
    throw createError(
      `Los turnos "${overlap.a}" y "${overlap.b}" se solapan`,
      "CASH_SCHEDULE_OVERLAP",
      400,
      overlap
    );
  }

  return shifts;
}
