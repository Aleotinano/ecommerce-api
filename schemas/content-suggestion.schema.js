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

/** Modos de refinamiento del copy. `custom` requiere instruccion libre. */
export const REFINEMENT_MODES = ["shorter", "informal", "salesy", "custom"];

/** Param :productId compartido por los endpoints del tab de producto. */
export const productIdParam = z.object({
  productId: z.coerce.number().int().positive(),
});

/** Body de POST /products/:productId/generate. */
export const generateBody = z.object({
  angle: z.enum(SUGGESTION_ANGLES),
});

/** Body de POST /refine: pide una variacion de un copy ya generado. */
export const refineBody = z
  .object({
    productId: z.coerce.number().int().positive(),
    angle: z.enum(SUGGESTION_ANGLES),
    mode: z.enum(REFINEMENT_MODES),
    instruction: z.string().trim().min(1).max(280).optional(),
    baseCopy: z.string().trim().min(1).max(2000),
    baseHashtags: z.array(z.string().trim().max(80)).max(20).default([]),
  })
  .refine((data) => data.mode !== "custom" || Boolean(data.instruction), {
    message: "El modo 'custom' requiere una instruccion",
    path: ["instruction"],
  });
