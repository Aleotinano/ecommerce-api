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
 * Cuándo EMPEZÓ la ocurrencia del turno que contiene a `now`. Espejo de
 * `shiftExpiry`: para un turno que cruza la medianoche, si ya estamos del otro lado
 * (01:00 del turno 20–02) el inicio fue ayer a las 20:00.
 *
 * Sirve para distinguir dos ocurrencias del MISMO turno —el "Día" de ayer y el de
 * hoy—, que es lo único que separa un turno colgado de uno vigente en un local que
 * tiene un solo turno diario.
 */
export function shiftStart(now, shift) {
  const start = new Date(now);
  start.setHours(0, shift.from, 0, 0);

  if (shift.overnight && minutesOfDay(now) < shift.to) {
    start.setDate(start.getDate() - 1);
  }

  return start;
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
 * Cuándo arranca la PRÓXIMA ocurrencia de cualquier turno del horario. `null` sin
 * horario cargado.
 *
 * Es lo que le pone vencimiento a una caja que quedó abierta fuera de hora —la que
 * deja el cierre del día cuando se firma a las 20:05 y el turno terminaba 20:00—.
 * Sin esto esa caja no vence nunca, `shouldAutoClose` no la puede levantar, y los
 * cobros de mañana caen adentro del día de ayer, que es justo el bug que el cierre
 * por ocurrencia vino a arreglar.
 *
 * Se mira turno por turno el arranque de hoy y el de mañana, y gana el primero que
 * caiga después de `now`: son a lo sumo 12 fechas (`MAX_SHIFTS` × 2) y no hay caso
 * raro de medianoche que resolver a mano.
 */
export function nextShiftStart(now, schedule) {
  const shifts = parseSchedule(schedule);
  let next = null;

  for (const shift of shifts) {
    const hoy = new Date(now);
    hoy.setHours(0, shift.from, 0, 0);

    const siguiente = new Date(hoy);
    // `setDate` y no sumar 24 h en milisegundos: el día del cambio de hora, sumar
    // milisegundos deja el arranque corrido 60 minutos.
    siguiente.setDate(siguiente.getDate() + 1);

    for (const start of [hoy, siguiente]) {
      if (start.getTime() <= now.getTime()) continue;
      if (!next || start.getTime() < next.getTime()) next = start;
    }
  }

  return next;
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
 * gracia, **y** ya arrancó OTRA ocurrencia de turno. Sin esa última condición se
 * cerraría un turno solo por terminar el horario, aunque nadie fuera a abrir otro —
 * y ahí lo correcto es dejarlo abierto y avisar.
 *
 * "Otra ocurrencia" es lo que hay que mirar, y no solo la etiqueta: un local con un
 * único turno diario ("Día" 09–20) tiene el mismo nombre todos los días, así que
 * comparar etiquetas dejaba el turno de ayer abierto para siempre y los cobros de hoy
 * caían adentro. Se compara contra el inicio de la ocurrencia vigente: si el turno
 * abierto vencía antes de que esta empezara, es de una vuelta anterior.
 */
export function shouldAutoClose(session, { now = new Date(), schedule } = {}) {
  if (expiredByMinutes(session, now) <= AUTO_CLOSE_GRACE_MINUTES) return false;

  const actual = shiftFor(now, schedule);
  if (!actual) return false;

  if (actual.label !== session.label) return true;

  return (
    new Date(session.expiresAt).getTime() <= shiftStart(now, actual).getTime()
  );
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
