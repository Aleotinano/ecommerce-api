import prisma from "../../lib/prisma.js";
import { get, set, tenantNs } from "../../lib/cache.js";
import { startOfDay, addDays } from "../stats/utils.js";
import { TenantConfigModel } from "../tenant-config.js";
import { generateCopy } from "../../lib/llm/index.js";
import { selectProduct } from "./selection.js";

/** Producto incluido en la respuesta (la imagen sale del catalogo). */
const productInclude = {
  product: {
    select: {
      id: true,
      name: true,
      description: true,
      price: true,
      img: true,
      imgPublicId: true,
      category: { select: { id: true, name: true } },
    },
  },
};

/** TTL del cache de la sugerencia del dia (6 h). El unique(tenantId,date) ya
 * garantiza una por dia; el cache solo evita relecturas. */
const SUGGESTION_TTL = 6 * 60 * 60;

const suggestionKey = (tenantId, date) =>
  `${tenantNs(tenantId)}:content-suggestion:${date.toISOString().slice(0, 10)}`;

/** Clave por dia (YYYY-MM-DD) consistente con suggestionKey. */
const dayKey = (date) => date.toISOString().slice(0, 10);

/** Forma liviana de la sugerencia para la timeline. */
const toTimelineSuggestion = (s) => ({
  id: s.id,
  angle: s.angle,
  status: s.status,
  product: { name: s.product.name, img: s.product.img },
  copy: s.copy,
  hashtags: s.hashtags,
});

/** Trae la config de marca sin cortar la generacion si el tenant no tiene una. */
const loadBrandConfig = async (tenantId) => {
  try {
    return await TenantConfigModel.get({ tenantId });
  } catch {
    return null;
  }
};

export const ContentSuggestionModel = {
  /**
   * Devuelve la sugerencia del dia para el tenant. Si no existe, selecciona el
   * producto (Fase 1), genera copy + hashtags con el LLM (Fase 2) y la persiste.
   * El unique (tenantId, date) asegura una sola por dia; ante una carrera (P2002)
   * re-lee la existente. Se cachea en Redis para relecturas del mismo dia.
   */
  async getToday({ tenantId, now = new Date() }) {
    const date = startOfDay(now);
    const cacheKey = suggestionKey(tenantId, date);

    const cached = await get(cacheKey);
    if (cached) {
      return cached;
    }

    const existing = await prisma.contentSuggestion.findUnique({
      where: { tenantId_date: { tenantId, date } },
      include: productInclude,
    });

    if (existing) {
      await set(cacheKey, existing, SUGGESTION_TTL);
      return existing;
    }

    const { productId, angle } = await selectProduct({ tenantId, now });

    const product = await prisma.product.findFirst({
      where: { id: productId, tenantId },
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        category: { select: { name: true } },
      },
    });

    const config = await loadBrandConfig(tenantId);

    // Best-effort: nunca lanza, cae a fallback por template si el LLM falla.
    const { copy, hashtags, model } = await generateCopy({
      product,
      angle,
      config,
    });

    let suggestion;
    try {
      suggestion = await prisma.contentSuggestion.create({
        data: {
          tenantId,
          productId,
          angle,
          date,
          copy,
          hashtags,
          model,
          generatedAt: new Date(),
        },
        include: productInclude,
      });
    } catch (error) {
      if (error.code === "P2002") {
        suggestion = await prisma.contentSuggestion.findUnique({
          where: { tenantId_date: { tenantId, date } },
          include: productInclude,
        });
      } else {
        throw error;
      }
    }

    await set(cacheKey, suggestion, SUGGESTION_TTL);
    return suggestion;
  },

  /**
   * Timeline de los ultimos `range` dias (incluido hoy) para el tenant. Devuelve
   * el rango COMPLETO: los dias sin sugerencia vienen con `suggestion: null` para
   * que el front dibuje placeholders. Sin cache: refleja al toque cambios de
   * status y regeneraciones.
   */
  async getRange({ tenantId, range, now = new Date() }) {
    const today = startOfDay(now);
    const start = startOfDay(addDays(now, -(range - 1)));

    const rows = await prisma.contentSuggestion.findMany({
      where: { tenantId, date: { gte: start, lte: today } },
      select: {
        id: true,
        angle: true,
        status: true,
        copy: true,
        hashtags: true,
        date: true,
        product: { select: { name: true, img: true } },
      },
      orderBy: { date: "asc" },
    });

    const byDay = new Map(rows.map((s) => [dayKey(s.date), s]));

    const days = [];
    for (let i = 0; i < range; i += 1) {
      const date = startOfDay(addDays(start, i));
      const key = dayKey(date);
      const s = byDay.get(key) ?? null;
      days.push({
        date: key,
        hasSuggestion: Boolean(s),
        suggestion: s ? toTimelineSuggestion(s) : null,
      });
    }

    return { range, days };
  },
};
