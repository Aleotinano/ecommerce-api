import { z } from "zod";

export const SUGGESTION_ANGLES = [
  "BEST_SELLER",
  "NEW_ARRIVAL",
  "LOW_STOCK",
  "NO_RECENT_SALES",
];

export const SUGGESTION_STATUSES = ["SUGGESTED", "USED", "DISMISSED"];

const ALLOWED_RANGES = [7, 15, 30];

/** Timeline: GET /content-suggestions?range=7|15|30 (default 7). */
export const suggestionRangeQuery = z.object({
  range: z.coerce
    .number()
    .int()
    .refine((v) => ALLOWED_RANGES.includes(v), {
      message: "El rango debe ser 7, 15 o 30",
    })
    .default(7),
});

/**
 * Por ahora `getToday` no necesita body ni params. Se deja preparado un schema
 * de query para filtrar historico por fecha mas adelante (Fase 2+).
 */
export const suggestionQuery = z.object({
  date: z.coerce.date().optional(),
});
