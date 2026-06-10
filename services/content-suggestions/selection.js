import { createError } from "../../helpers/error.js";
import { addDays, startOfDay } from "../stats/utils.js";
import { loadSelectionData } from "./queries.js";
import { ANGLE_ORDER, ANGLE_SELECTORS } from "./angles.js";

/** Ventana de dias para "mas vendido" y "sin ventas recientes" (igual a stats). */
const WINDOW_DAYS = 30;

/** Suma unidades vendidas por productId recorriendo orderItems -> variant. */
const buildSalesByProduct = (completedOrders) => {
  const sales = new Map();

  for (const order of completedOrders) {
    for (const item of order.orderItems) {
      const productId = item.variant?.productId;
      if (!productId) continue;
      sales.set(productId, (sales.get(productId) ?? 0) + item.quantity);
    }
  }

  return sales;
};

/**
 * Devuelve el angulo por el que arranca la rotacion: el siguiente en ANGLE_ORDER
 * despues del ultimo usado. Si no hay sugerencia previa, arranca por el primero.
 */
const nextAngleIndex = (lastAngle) => {
  if (!lastAngle) return 0;
  const lastIndex = ANGLE_ORDER.indexOf(lastAngle);
  if (lastIndex === -1) return 0;
  return (lastIndex + 1) % ANGLE_ORDER.length;
};

/**
 * Elige que producto destacar hoy para el tenant.
 * Rota los angulos secuencialmente arrancando en el siguiente al ultimo usado;
 * el primer angulo que tenga candidato gana (fallback automatico).
 *
 * @returns {Promise<{ productId: number, angle: string }>}
 */
export const selectProduct = async ({ tenantId, now = new Date() }) => {
  const windowStart = startOfDay(addDays(now, -(WINDOW_DAYS - 1)));

  const { completedOrders, products, lastSuggestion } = await loadSelectionData({
    tenantId,
    windowStart,
    now,
  });

  const salesByProduct = buildSalesByProduct(completedOrders);
  const enriched = products.map((product) => ({
    ...product,
    units: salesByProduct.get(product.id) ?? 0,
  }));

  const start = nextAngleIndex(lastSuggestion?.angle);

  for (let offset = 0; offset < ANGLE_ORDER.length; offset += 1) {
    const angle = ANGLE_ORDER[(start + offset) % ANGLE_ORDER.length];
    const productId = ANGLE_SELECTORS[angle](enriched);

    if (productId) {
      return { productId, angle };
    }
  }

  throw createError(
    "Sin productos para sugerir",
    "NO_SUGGESTION_CANDIDATE",
    422
  );
};
