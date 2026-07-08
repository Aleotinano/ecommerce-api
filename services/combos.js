import { createError } from "../helpers/error.js";
import { resolveProductStock } from "../helpers/price.js";

const selectionKey = (s) => `${s.productId}::${s.variantId ?? ""}`;

/**
 * Valida la selección de un cliente para UN combo (`comboProduct.type === "COMBO"`)
 * contra su whitelist (`ComboAllowedProduct`) y devuelve la selección normalizada
 * `[{ productId, variantId, quantity }]` (agrupada, cantidades para UNA unidad de
 * combo). Compartido por `services/cart.js` (agregar al carrito) y
 * `services/orders.js` (`priceItems`, al pasar a orden) para no duplicar la regla.
 *
 * Cada componente elegido es un producto UNIDAD o VARIANTE de la whitelist (nunca
 * COMBO — sin anidamiento). Para VARIANTE, `variantId` es obligatorio en la selección;
 * para UNIDAD no aplica (se ignora si viene).
 *
 * @param {object} p
 * @param {object} p.tx            cliente de transacción de Prisma
 * @param {number} p.tenantId
 * @param {object} p.comboProduct  producto combo (con id, comboMinItems, comboMaxItems)
 * @param {Array}  p.selection     `[{ productId, variantId?, quantity }]`
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

  if (
    selection.some(
      (s) => !Number.isInteger(s.quantity) || s.quantity <= 0 || !Number.isInteger(s.productId)
    )
  ) {
    throw createError(
      "Cantidad inválida en la selección del combo",
      "COMBO_SELECTION_OUT_OF_RANGE",
      400
    );
  }

  // Agrupa por producto+variante, por si la selección repite la misma línea.
  const grouped = new Map();
  for (const s of selection) {
    const key = selectionKey(s);
    const existing = grouped.get(key);
    grouped.set(key, {
      productId: s.productId,
      variantId: s.variantId ?? null,
      quantity: (existing?.quantity ?? 0) + s.quantity,
    });
  }
  const lines = [...grouped.values()];

  const totalQty = lines.reduce((sum, l) => sum + l.quantity, 0);
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

  const productIds = [...new Set(lines.map((l) => l.productId))];
  const products = await tx.product.findMany({
    where: { id: { in: productIds }, tenantId },
    include: { variants: true },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  const allowed = await tx.comboAllowedProduct.findMany({
    where: { comboProductId: comboProduct.id, tenantId, isActive: true },
  });
  const allowedByProduct = new Map(allowed.map((a) => [a.allowedProductId, a]));

  // Cantidad total por PRODUCTO (para min/maxQty de la whitelist, sin importar variante).
  const qtyByProduct = new Map();
  for (const line of lines) {
    if (!productMap.has(line.productId)) {
      throw createError("Producto no encontrado", "PRODUCT_NOT_FOUND", 404);
    }
    qtyByProduct.set(line.productId, (qtyByProduct.get(line.productId) ?? 0) + line.quantity);
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
  for (const line of lines) {
    const product = productMap.get(line.productId);

    if (product.type === "COMBO") {
      throw createError("No se permiten combos anidados", "COMBO_NESTED_NOT_ALLOWED", 400);
    }
    if (!product.isActive) {
      const error = createError(
        "Producto del combo no disponible",
        "COMBO_PRODUCT_NOT_ALLOWED",
        400
      );
      error.details = { productId: line.productId };
      throw error;
    }

    let variant = null;
    if (product.type === "VARIANTE") {
      variant = product.variants.find((v) => v.id === line.variantId);
      if (!variant) {
        throw createError("Variante no encontrada", "VARIANT_NOT_FOUND", 404);
      }
      if (!variant.isActive) {
        const error = createError(
          "Producto del combo no disponible",
          "COMBO_PRODUCT_NOT_ALLOWED",
          400
        );
        error.details = { variant: variant.id };
        throw error;
      }
    }

    const stock = resolveProductStock(product, variant);
    if (checkStock && line.quantity > (stock ?? 0)) {
      const error = createError("Stock insuficiente", "INSUFFICIENT_STOCK", 409);
      error.details = {
        productId: line.productId,
        variant: variant?.id ?? null,
        solicitado: line.quantity,
        disponible: stock ?? 0,
      };
      throw error;
    }

    children.push({
      productId: line.productId,
      variantId: variant?.id ?? null,
      quantity: line.quantity,
    });
  }

  return children;
}
