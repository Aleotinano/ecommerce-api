import { createError } from "../helpers/error.js";

/**
 * Valida la selección de un cliente para UN combo (`comboProduct.isCombo === true`)
 * contra su whitelist (`ComboAllowedProduct`) y devuelve la selección normalizada
 * `[{ variantId, quantity }]` (agrupada por variante, cantidades para UNA unidad de
 * combo). Compartido por `services/cart.js` (agregar al carrito) y
 * `services/orders.js` (`priceItems`, al pasar a orden) para no duplicar la regla.
 *
 * @param {object} p
 * @param {object} p.tx            cliente de transacción de Prisma
 * @param {number} p.tenantId
 * @param {object} p.comboProduct  producto combo (con id, comboMinItems, comboMaxItems)
 * @param {Array}  p.selection     `[{ variantId, quantity }]`
 * @param {boolean} p.checkStock   si valida stock de cada componente elegido
 */
export async function validateComboSelection({
  tx,
  tenantId,
  comboProduct,
  selection,
  checkStock,
}) {
  if (!Array.isArray(selection) || selection.length === 0) {
    throw createError(
      "Debés elegir productos para el combo",
      "COMBO_SELECTION_REQUIRED",
      400
    );
  }

  if (selection.some((s) => !Number.isInteger(s.quantity) || s.quantity <= 0)) {
    throw createError(
      "Cantidad inválida en la selección del combo",
      "COMBO_SELECTION_OUT_OF_RANGE",
      400
    );
  }

  // Agrupa por variante, por si la selección repite la misma variante en dos filas.
  const byVariant = new Map();
  for (const s of selection) {
    byVariant.set(s.variantId, (byVariant.get(s.variantId) ?? 0) + s.quantity);
  }

  const totalQty = [...byVariant.values()].reduce((sum, q) => sum + q, 0);
  const { comboMinItems, comboMaxItems } = comboProduct;
  if (
    (comboMinItems != null && totalQty < comboMinItems) ||
    (comboMaxItems != null && totalQty > comboMaxItems)
  ) {
    const error = createError(
      "La cantidad elegida no cumple el mínimo/máximo del combo",
      "COMBO_SELECTION_OUT_OF_RANGE",
      400
    );
    error.details = { comboMinItems, comboMaxItems, total: totalQty };
    throw error;
  }

  const variantIds = [...byVariant.keys()];
  const variants = await tx.productVariant.findMany({
    where: { id: { in: variantIds }, tenantId },
    include: { product: true },
  });
  const variantMap = new Map(variants.map((v) => [v.id, v]));

  const allowed = await tx.comboAllowedProduct.findMany({
    where: { comboProductId: comboProduct.id, tenantId, isActive: true },
  });
  const allowedByProduct = new Map(allowed.map((a) => [a.allowedProductId, a]));

  // Cantidad total por PRODUCTO (para min/maxQty de la whitelist, no por variante).
  const qtyByProduct = new Map();
  for (const [variantId, qty] of byVariant) {
    const variant = variantMap.get(variantId);
    if (!variant) {
      throw createError("Variante no encontrada", "VARIANT_NOT_FOUND", 404);
    }
    qtyByProduct.set(
      variant.productId,
      (qtyByProduct.get(variant.productId) ?? 0) + qty
    );
  }

  for (const [productId, qty] of qtyByProduct) {
    const rule = allowedByProduct.get(productId);
    if (!rule) {
      const error = createError(
        "Ese producto no está permitido en este combo",
        "COMBO_PRODUCT_NOT_ALLOWED",
        400
      );
      error.details = { productId };
      throw error;
    }
    if ((rule.minQty && qty < rule.minQty) || (rule.maxQty != null && qty > rule.maxQty)) {
      const error = createError(
        "La cantidad de ese producto no respeta el mínimo/máximo permitido",
        "COMBO_ITEM_QTY_OUT_OF_RANGE",
        400
      );
      error.details = { productId, minQty: rule.minQty, maxQty: rule.maxQty };
      throw error;
    }
  }

  const children = [];
  for (const [variantId, qty] of byVariant) {
    const variant = variantMap.get(variantId);
    if (!variant.isActive || !variant.product?.isActive) {
      const error = createError(
        "Producto del combo no disponible",
        "COMBO_PRODUCT_NOT_ALLOWED",
        400
      );
      error.details = { variant: variantId };
      throw error;
    }
    if (checkStock && qty > variant.stock) {
      const error = createError("Stock insuficiente", "INSUFFICIENT_STOCK", 409);
      error.details = { variant: variant.id, solicitado: qty, disponible: variant.stock };
      throw error;
    }
    children.push({ variantId, quantity: qty });
  }

  return children;
}
