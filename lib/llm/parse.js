/**
 * Parseo robusto de la respuesta del LLM. Esperamos JSON puro, pero los modelos
 * a veces envuelven en fences ```json o agregan prosa alrededor. Limpiamos,
 * recortamos al objeto, validamos la forma y normalizamos los hashtags.
 *
 * @returns {{ copy: string, hashtags: string[] } | null} null si no se pudo.
 */
const MAX_HASHTAGS = 6;

/** Quita fences de markdown (```json ... ``` o ``` ... ```). */
const stripFences = (text) =>
  text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();

/** Recorta del primer { al ultimo } para descartar prosa alrededor. */
const extractObject = (text) => {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  return text.slice(first, last + 1);
};

/** Asegura que cada hashtag empiece con # y no tenga espacios. */
const normalizeHashtag = (tag) => {
  const clean = String(tag).trim().replace(/\s+/g, "");
  if (!clean) return null;
  return clean.startsWith("#") ? clean : `#${clean.replace(/^#+/, "")}`;
};

export const parseLlmJson = (text) => {
  if (typeof text !== "string" || !text.trim()) return null;

  const candidate = extractObject(stripFences(text));
  if (!candidate) return null;

  let data;
  try {
    data = JSON.parse(candidate);
  } catch {
    return null;
  }

  if (!data || typeof data !== "object") return null;

  const copy = typeof data.copy === "string" ? data.copy.trim() : "";
  if (!copy) return null;

  const rawHashtags = Array.isArray(data.hashtags) ? data.hashtags : [];
  const hashtags = rawHashtags
    .map(normalizeHashtag)
    .filter(Boolean)
    .slice(0, MAX_HASHTAGS);

  return { copy, hashtags };
};
