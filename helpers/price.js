/** Redondea un monto a 2 decimales (el modelo usa Float). */
export const roundMoney = (n) => Math.round(n * 100) / 100;

/**
 * Precio efectivo de una línea, según el tipo de producto (`Product.type`):
 * - COMBO: `product.price` (precio fijo del combo).
 * - PRODUCTO: `variant.price` (autoritativo — todo PRODUCTO tiene siempre una
 *   variante, nunca hay fallback a nivel producto). `null` si por algún motivo no
 *   se resolvió ninguna variante (ver `resolveVariantForProduct`).
 */
export function getProductPrice(variant, product) {
  if (product?.type === "COMBO") {
    return product.price ?? null;
  }
  return variant?.price ?? null;
}

/**
 * Stock efectivo de una línea, según el tipo de producto:
 * - COMBO: `null` — no tiene stock propio, se valida/descuenta sobre los componentes
 *   elegidos (ver services/combos.js, services/orders.js).
 * - PRODUCTO: `variant.stock`.
 */
export function resolveProductStock(product, variant) {
  if (product?.type === "COMBO") {
    return null;
  }
  return variant?.stock ?? 0;
}

/**
 * Resuelve qué `ProductVariant` de un `product` ya cargado (con `variants`) aplica a
 * una línea: la indicada por `variantId` si viene, o la principal (`isDefault`) si
 * no — así una línea sin elección explícita (ej. "agregar al carrito" sin abrir el
 * picker) sigue funcionando igual que antes para un producto sin opciones reales.
 * `null` si no se encuentra (ej. producto sin ninguna variante todavía — estado
 * transitorio de un alta en 2 pasos). No aplica a COMBO (no tiene variantes propias).
 */
export function resolveVariantForProduct(product, variantId) {
  const variants = product?.variants ?? [];
  if (variantId != null) {
    return variants.find((v) => v.id === variantId) ?? null;
  }
  return variants.find((v) => v.isDefault) ?? null;
}
