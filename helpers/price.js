/**
 * Precio efectivo de una línea, según el tipo de producto (`Product.type`):
 * - VARIANTE: precio de la variante (autoritativo, sin fallback a `product.price` — el
 *   tipo ya saca la ambigüedad). `null` si la variante no tiene precio.
 * - UNIDAD / COMBO: `product.price` (para COMBO es el precio fijo del combo).
 *
 * Si `product.type` no viene definido (código legado / objeto parcial), mantiene el
 * fallback anterior (`variant?.price ?? product?.price`) para no romper llamadas que
 * todavía no pasan un `product` con `type`.
 */
export function getProductPrice(variant, product) {
  if (product?.type === "VARIANTE") {
    return variant?.price ?? null;
  }
  if (product?.type === "UNIDAD" || product?.type === "COMBO") {
    return product.price ?? null;
  }

  if (variant?.price != null) {
    return variant.price;
  }
  if (product?.price != null) {
    return product.price;
  }
  return null;
}

/**
 * Stock efectivo de una línea, según el tipo de producto:
 * - VARIANTE: `variant.stock`.
 * - UNIDAD: `product.stock`.
 * - COMBO: `null` — no tiene stock propio, se valida/descuenta sobre los componentes
 *   elegidos (ver services/combos.js, services/orders.js).
 */
export function resolveProductStock(product, variant) {
  if (product?.type === "VARIANTE") {
    return variant?.stock ?? 0;
  }
  if (product?.type === "UNIDAD") {
    return product?.stock ?? 0;
  }
  return null;
}
