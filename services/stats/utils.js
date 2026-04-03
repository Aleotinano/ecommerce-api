import { DAY_IN_MS } from "./constants.js";

/** Normaliza una fecha al inicio del dia local del servidor. */
export const startOfDay = (date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

/** Suma o resta dias manteniendo el tipo Date. */
export const addDays = (date, days) =>
  new Date(date.getTime() + days * DAY_IN_MS);

/** Redondea valores monetarios y porcentajes a dos decimales. */
export const round = (value) => Number((value ?? 0).toFixed(2));

/**
 * Calcula la variacion porcentual entre dos periodos.
 * Retorna null cuando no existe base comparativa y el periodo actual tiene valor.
 */
export const percentageChange = ({ current, previous }) => {
  if (previous === 0) {
    return current === 0 ? 0 : null;
  }

  return round(((current - previous) / previous) * 100);
};

/** Empaqueta un KPI con valores actuales, previos y variacion. */
export const buildMetric = ({ current, previous }) => ({
  current: round(current),
  previous: round(previous),
  changePct: percentageChange({ current, previous }),
});
