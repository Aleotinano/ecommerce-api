import { z } from "zod";

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Fecha de filtro que respeta el día que el usuario escribió.
 *
 * `z.coerce.date()` parsea `"2026-07-01"` como medianoche **UTC**, y con el server en
 * UTC−3 eso son las 21:00 del 30 de junio: "el Excel de julio" arrancaba un día antes
 * y —peor— `to=2026-07-31` dejaba afuera casi todo el 31. Un `YYYY-MM-DD` es un día
 * calendario, no un instante, así que se ancla al **día local**: el `from` al arranque
 * y el `to` al final. Una fecha con hora explícita se respeta tal cual.
 *
 * Lo usan los dos filtros por rango del backoffice (caja y órdenes): es la clase de
 * detalle que, duplicado, se arregla en un lado nada más.
 */
export const dayBoundary = (edge, label) =>
  z.preprocess(
    (value) => {
      if (typeof value !== "string") return value;

      const match = DATE_ONLY.exec(value.trim());
      if (!match) return value;

      const [year, month, day] = match.slice(1).map(Number);

      return edge === "end"
        ? new Date(year, month - 1, day, 23, 59, 59, 999)
        : new Date(year, month - 1, day, 0, 0, 0, 0);
    },
    z.coerce.date({ invalid_type_error: `La fecha ${label} es inválida` }).optional()
  );
