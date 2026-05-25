import { randomBytes } from "node:crypto";
import { createError } from "../helpers/error.js";

const MAX_LEN = 40;
const MIN_LEN = 3;

export function slugify(name) {
  if (typeof name !== "string") {
    throw createError(
      "Nombre de tenant inválido para generar slug",
      "INVALID_TENANT_NAME",
      400
    );
  }

  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_LEN)
    .replace(/-+$/g, "");

  if (slug.length < MIN_LEN) {
    throw createError(
      "Nombre de tenant inválido para generar slug",
      "INVALID_TENANT_NAME",
      400
    );
  }

  return slug;
}

function randomShort() {
  return randomBytes(3).toString("hex");
}

function withinMax(base, suffix) {
  const room = MAX_LEN - suffix.length - 1;
  const trimmedBase = base.slice(0, Math.max(MIN_LEN, room)).replace(/-+$/g, "");
  return `${trimmedBase}-${suffix}`;
}

export async function suggestSlugAlternatives(baseSlug, existsFn, n = 3) {
  const suggestions = [];

  for (let i = 2; suggestions.length < n && i < 50; i++) {
    const candidate = withinMax(baseSlug, String(i));
    if (!(await existsFn(candidate))) suggestions.push(candidate);
  }

  let safety = 0;
  while (suggestions.length < n && safety++ < 10) {
    const candidate = withinMax(baseSlug, randomShort());
    if (!suggestions.includes(candidate) && !(await existsFn(candidate))) {
      suggestions.push(candidate);
    }
  }

  return suggestions;
}
