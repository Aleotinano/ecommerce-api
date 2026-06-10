/**
 * Selectores puros por angulo. Cada uno recibe el catalogo del tenant ya
 * enriquecido y devuelve el productId elegido, o null si no hay candidato.
 *
 * Forma de cada producto en `products`:
 *   { id, name, isActive, createdAt, variants: [{ stock, isActive }], units }
 * donde `units` son las unidades vendidas en COMPLETED dentro de la ventana.
 */

export const LOW_STOCK_THRESHOLD = 5;

/** Orden de rotacion de los angulos. */
export const ANGLE_ORDER = [
  "BEST_SELLER",
  "NEW_ARRIVAL",
  "LOW_STOCK",
  "NO_RECENT_SALES",
];

const activeVariants = (product) =>
  product.variants.filter((variant) => variant.isActive);

/** Stock total del producto sumando todas sus variantes activas. */
const totalStock = (product) =>
  activeVariants(product).reduce((sum, variant) => sum + variant.stock, 0);

const hasAvailableStock = (product) => totalStock(product) > 0;

/** Stock agregado bajo: hay unidades pero el total esta por agotarse. */
const hasLowStock = (product) => {
  const stock = totalStock(product);
  return stock > 0 && stock <= LOW_STOCK_THRESHOLD;
};

/** Producto activo con mas unidades vendidas en la ventana. */
const bestSeller = (products) => {
  const sold = products
    .filter((product) => product.isActive && product.units > 0)
    .sort((a, b) => b.units - a.units);

  return sold[0]?.id ?? null;
};

/** Producto activo con createdAt mas reciente. */
const newArrival = (products) => {
  const active = products
    .filter((product) => product.isActive)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return active[0]?.id ?? null;
};

/** Producto activo con alguna variante activa en stock bajo (>0 y <=umbral). */
const lowStock = (products) => {
  const candidates = products
    .filter((product) => product.isActive && hasLowStock(product))
    .sort((a, b) => b.units - a.units);

  return candidates[0]?.id ?? null;
};

/** Producto activo, con stock disponible, sin ventas en la ventana. */
const noRecentSales = (products) => {
  const candidates = products.filter(
    (product) =>
      product.isActive && product.units === 0 && hasAvailableStock(product)
  );

  return candidates[0]?.id ?? null;
};

export const ANGLE_SELECTORS = {
  BEST_SELLER: bestSeller,
  NEW_ARRIVAL: newArrival,
  LOW_STOCK: lowStock,
  NO_RECENT_SALES: noRecentSales,
};
