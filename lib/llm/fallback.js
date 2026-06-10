/**
 * Copy de fallback por template, deterministico y sin red. Se usa cuando el LLM
 * falla, no hay API key, o el JSON es invalido: la sugerencia se persiste igual
 * para que el usuario siempre vea algo.
 */
import { ANGLE_BRIEFS } from "./prompt.js";

/**
 * Convierte un texto en un hashtag CamelCase sin acentos ni espacios.
 * NFD descompone los acentos en base + marca combinante, y el filtro ASCII
 * descarta esas marcas (y cualquier simbolo) sin necesidad de un regex aparte.
 */
const toHashtag = (text) => {
  if (text == null) return null;
  const clean = String(text)
    .normalize("NFD")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .trim();
  if (!clean) return null;
  const camel = clean
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
  return `#${camel}`;
};

const ANGLE_HASHTAG = {
  BEST_SELLER: "#MasVendido",
  NEW_ARRIVAL: "#NuevoIngreso",
  LOW_STOCK: "#UltimasUnidades",
  NO_RECENT_SALES: "#Redescubri",
};

export const buildFallbackCopy = ({ product, angle, config }) => {
  const storeName = config?.storeName || "nuestra tienda";
  const name = product?.name || "este producto";
  const brief = ANGLE_BRIEFS[angle] ?? ANGLE_BRIEFS.BEST_SELLER;

  const copy = `${name} en ${storeName}. ${brief}`;

  const hashtags = [
    toHashtag(storeName),
    toHashtag(product?.name),
    toHashtag(product?.category?.name),
    ANGLE_HASHTAG[angle] ?? ANGLE_HASHTAG.BEST_SELLER,
  ].filter(Boolean);

  // Dedup conservando orden
  return { copy, hashtags: [...new Set(hashtags)] };
};
