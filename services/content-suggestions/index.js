import prisma from "../../lib/prisma.js";
import { get, set, tenantNs } from "../../lib/cache.js";
import { createError } from "../../helpers/error.js";
import { startOfDay, addDays } from "../stats/utils.js";
import { TenantConfigModel } from "../tenant-config.js";
import { generateCopy, refineCopy } from "../../lib/llm/index.js";
import { selectProduct, anglesForProduct } from "./selection.js";
import { consumeLlmQuota } from "./cost-guard.js";

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

/** TTL del cache de sugerencias (6 h). El unique a nivel DB ya dedupe; el cache
 * solo evita relecturas y regeneraciones dentro del dia. */
const SUGGESTION_TTL = 6 * 60 * 60;

/** Clave por dia (YYYY-MM-DD) consistente con las cache keys. */
const dayKey = (date) => date.toISOString().slice(0, 10);

const suggestionKey = (tenantId, date) =>
  `${tenantNs(tenantId)}:content-suggestion:${dayKey(date)}`;

/** Cache de la generacion on-demand por (tenant + dia + producto + angulo). */
const copyKey = (tenantId, date, productId, angle) =>
  `${tenantNs(tenantId)}:content-copy:${dayKey(date)}:${productId}:${angle}`;

/** Campos del producto que necesita el prompt del LLM. */
const productForPrompt = {
  id: true,
  name: true,
  description: true,
  price: true,
  category: { select: { name: true } },
};

/** Carga un producto del tenant para alimentar el prompt; 404 si no existe. */
const loadProductForPrompt = async (tenantId, productId) => {
  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId },
    select: productForPrompt,
  });
  if (!product) {
    throw createError("Producto no encontrado", "PRODUCT_NOT_FOUND", 404);
  }
  return product;
};

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

    const existing = await prisma.contentSuggestion.findFirst({
      where: { tenantId, date, source: "AUTO" },
      include: productInclude,
    });

    if (existing) {
      await set(cacheKey, existing, SUGGESTION_TTL);
      return existing;
    }

    const { productId, angle } = await selectProduct({ tenantId, now });

    const product = await loadProductForPrompt(tenantId, productId);

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
          source: "AUTO",
          copy,
          hashtags,
          model,
          generatedAt: new Date(),
        },
        include: productInclude,
      });
    } catch (error) {
      // Carrera: ya existe una fila para (tenant, date, productId, angle). Re-leer
      // la automatica del dia (puede ser otra combinacion si hubo regeneracion).
      if (error.code === "P2002") {
        suggestion =
          (await prisma.contentSuggestion.findFirst({
            where: { tenantId, date, source: "AUTO" },
            include: productInclude,
          })) ??
          (await prisma.contentSuggestion.findUnique({
            where: {
              tenantId_date_productId_angle: { tenantId, date, productId, angle },
            },
            include: productInclude,
          }));
      } else {
        throw error;
      }
    }

    await set(cacheKey, suggestion, SUGGESTION_TTL);
    return suggestion;
  },

  /**
   * Lista los angulos que aplican a un producto puntual (tab de producto), reusando
   * los predicados de Fase 1. Devuelve briefs legibles para los chips del front.
   */
  async getProductAngles({ tenantId, productId, now = new Date() }) {
    const angles = await anglesForProduct({ tenantId, productId, now });
    return { productId, angles };
  },

  /**
   * Genera (o sirve cacheada/persistida) el copy de un producto para un angulo
   * puntual. Flujo: cache Redis -> fila en DB (dedupe por unique compuesto) ->
   * guarda de costo + LLM -> persiste (source MANUAL) -> cachea. Valida que el
   * angulo realmente aplique al producto antes de gastar una llamada al LLM.
   */
  async generateForProduct({ tenantId, productId, angle, now = new Date() }) {
    const date = startOfDay(now);
    const cacheKey = copyKey(tenantId, date, productId, angle);

    const cached = await get(cacheKey);
    if (cached) {
      return cached;
    }

    const existing = await prisma.contentSuggestion.findUnique({
      where: {
        tenantId_date_productId_angle: { tenantId, date, productId, angle },
      },
      include: productInclude,
    });
    if (existing) {
      await set(cacheKey, existing, SUGGESTION_TTL);
      return existing;
    }

    const applicable = await anglesForProduct({ tenantId, productId, now });
    if (!applicable.includes(angle)) {
      throw createError(
        "Ese angulo no aplica a este producto",
        "ANGLE_NOT_APPLICABLE",
        422
      );
    }

    const product = await loadProductForPrompt(tenantId, productId);
    const config = await loadBrandConfig(tenantId);

    await consumeLlmQuota({ tenantId, now });
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
          source: "MANUAL",
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
          where: {
            tenantId_date_productId_angle: { tenantId, date, productId, angle },
          },
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
   * Pide una variacion de un copy ya generado (mas corto / informal / vendedor /
   * cambio libre). Consume cuota de LLM y devuelve la variacion SIN persistir: es
   * una exploracion efimera que el front decide si usa.
   */
  async refineProductCopy({
    tenantId,
    productId,
    angle,
    mode,
    instruction,
    baseCopy,
    baseHashtags = [],
    now = new Date(),
  }) {
    const product = await loadProductForPrompt(tenantId, productId);
    const config = await loadBrandConfig(tenantId);

    await consumeLlmQuota({ tenantId, now });
    const { copy, hashtags, model } = await refineCopy({
      product,
      angle,
      config,
      mode,
      instruction,
      baseCopy,
      baseHashtags,
    });

    return { productId, angle, copy, hashtags, model };
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
