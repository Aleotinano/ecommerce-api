/**
 * Selectores puros por angulo. Cada uno recibe el catalogo del tenant ya
 * enriquecido y devuelve el productId elegido, o null si no hay candidato.
 *
 * Forma de cada producto en `products`:
 *   { id, name, isActive, createdAt, variants: [{ stock, isActive }], units }
 * donde `units` son las unidades vendidas en COMPLETED dentro de la ventana.
 *
 * La logica de "que califica para cada angulo" vive en ANGLE_PREDICATES (una sola
 * fuente de verdad): los selectores la reusan para elegir el destacado del dia, y
 * el tab de producto la reusa para filtrar que angulos aplican a un producto.
 */

export const LOW_STOCK_THRESHOLD = 5;

/** Ventana (dias) para considerar a un producto "recien llegado". */
export const NEW_ARRIVAL_DAYS = 30;

/** Ventana (dias) de ventas para "mas vendido" y "sin ventas recientes" (igual a stats). */
export const WINDOW_DAYS = 30;

/** Orden de rotacion de los angulos. */
export const ANGLE_ORDER = [
  "BEST_SELLER",
  "NEW_ARRIVAL",
  "LOW_STOCK",
  "NO_RECENT_SALES",
];

const activeVariants = (product) =>
  product.variants.filter((variant) => variant.isActive);

/**
 * Stock total del producto, segun su tipo: VARIANTE suma todas sus variantes
 * activas, UNIDAD usa `Product.stock`. COMBO no tiene stock propio (depende de sus
 * componentes) -> `null`, lo que excluye a los combos de LOW_STOCK/NO_RECENT_SALES
 * mas abajo. Ver docs/servicios/dominio/Combos.md.
 */
const totalStock = (product) => {
  if (product.type === "VARIANTE") {
    return activeVariants(product).reduce((sum, variant) => sum + variant.stock, 0);
  }
  if (product.type === "UNIDAD") {
    return product.stock ?? 0;
  }
  return null;
};

const hasAvailableStock = (product) => {
  const stock = totalStock(product);
  return stock != null && stock > 0;
};

/** Stock agregado bajo: hay unidades pero el total esta por agotarse. */
const hasLowStock = (product) => {
  const stock = totalStock(product);
  return stock != null && stock > 0 && stock <= LOW_STOCK_THRESHOLD;
};

/** Creado dentro de la ventana de novedades respecto a `now`. */
const isRecent = (product, now) => {
  const ageMs = now.getTime() - product.createdAt.getTime();
  return ageMs <= NEW_ARRIVAL_DAYS * 24 * 60 * 60 * 1000;
};

/**
 * Predicado por angulo: dado un producto enriquecido, decide si ese angulo le
 * aplica. Fuente unica de verdad compartida entre la seleccion del dia y el tab.
 */
export const ANGLE_PREDICATES = {
  BEST_SELLER: (product) => product.isActive && product.units > 0,
  NEW_ARRIVAL: (product, now = new Date()) =>
    product.isActive && isRecent(product, now),
  LOW_STOCK: (product) => product.isActive && hasLowStock(product),
  NO_RECENT_SALES: (product) =>
    product.isActive && product.units === 0 && hasAvailableStock(product),
};

/** Producto con mas unidades vendidas entre los que califican como BEST_SELLER. */
const bestSeller = (products) =>
  products
    .filter((product) => ANGLE_PREDICATES.BEST_SELLER(product))
    .sort((a, b) => b.units - a.units)[0]?.id ?? null;

/** Producto recien llegado con createdAt mas reciente. */
const newArrival = (products, now) =>
  products
    .filter((product) => ANGLE_PREDICATES.NEW_ARRIVAL(product, now))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]?.id ?? null;

/** Producto con stock bajo; desempata por mas vendido. */
const lowStock = (products) =>
  products
    .filter((product) => ANGLE_PREDICATES.LOW_STOCK(product))
    .sort((a, b) => b.units - a.units)[0]?.id ?? null;

/** Producto con stock disponible y sin ventas en la ventana. */
const noRecentSales = (products) =>
  products.filter((product) => ANGLE_PREDICATES.NO_RECENT_SALES(product))[0]
    ?.id ?? null;

export const ANGLE_SELECTORS = {
  BEST_SELLER: bestSeller,
  NEW_ARRIVAL: newArrival,
  LOW_STOCK: lowStock,
  NO_RECENT_SALES: noRecentSales,
};
