import { ORDER_STATUS_KEYS } from "./constants.js";
import { getOrderUnits, isCompletedOrder } from "./order-helpers.js";
import { round } from "./utils.js";
import { resolveProductStock } from "../../helpers/price.js";

const STATUS_META = {
  COMPLETED: { label: "Completadas", color: "green" },
  PENDING: { label: "Pendientes", color: "amber" },
  PROCESSING: { label: "En proceso", color: "blue" },
  CANCELLED: { label: "Canceladas", color: "red" },
};

const CATEGORY_COLORS = ["red", "blue", "green", "orange", "gray"];

const sortByRevenueAndUnits = (values) =>
  values.sort((a, b) => {
    if (b.revenue !== a.revenue) {
      return b.revenue - a.revenue;
    }

    return b.unitsSold - a.unitsSold;
  });

/** Construye la serie diaria para la grafica de barras del dashboard. */
export const buildDailySeries = ({ currentStart, days, orders }) => {
  const daysMap = new Map();

  for (let index = 0; index < days; index += 1) {
    const day = new Date(currentStart.getTime());
    day.setDate(currentStart.getDate() + index);
    const key = day.toISOString().slice(0, 10);
    daysMap.set(key, {
      date: key,
      revenue: 0,
      completedOrders: 0,
      orders: 0,
      unitsSold: 0,
    });
  }

  for (const order of orders) {
    const key = order.createdAt.toISOString().slice(0, 10);
    const bucket = daysMap.get(key);

    if (!bucket) {
      continue;
    }

    bucket.orders += 1;

    if (isCompletedOrder(order)) {
      bucket.completedOrders += 1;
      bucket.revenue = round(bucket.revenue + order.total);
      bucket.unitsSold += getOrderUnits(order);
    }
  }

  return Array.from(daysMap.values());
};

/** Devuelve distribucion de ordenes y tasas del periodo actual. */
export const buildOrderStatusPanel = (orders) => {
  const counts = Object.fromEntries(ORDER_STATUS_KEYS.map((key) => [key, 0]));

  for (const order of orders) {
    counts[order.status] = (counts[order.status] ?? 0) + 1;
  }

  const total = orders.length;
  const completed = counts.COMPLETED ?? 0;
  const cancelled = counts.CANCELLED ?? 0;
  const conversionRate = total > 0 ? round((completed / total) * 100) : 0;
  const cancellationRate = total > 0 ? round((cancelled / total) * 100) : 0;

  return {
    totalOrders: total,
    statuses: ORDER_STATUS_KEYS.map((status) => ({
      key: status,
      label: STATUS_META[status].label,
      color: STATUS_META[status].color,
      count: counts[status] ?? 0,
      percentage: total > 0 ? round(((counts[status] ?? 0) / total) * 100) : 0,
    })),
    conversion: {
      rate: conversionRate,
      label: "creadas a completadas",
      completedOrders: completed,
      totalOrders: total,
      cancellationRate,
    },
  };
};

/** Agrupa revenue por categoria para el donut del dashboard. */
export const buildRevenueByCategory = (orders) => {
  const categories = new Map();

  for (const order of orders) {
    if (!isCompletedOrder(order)) {
      continue;
    }

    for (const item of order.orderItems) {
      const category = item.product?.category;
      const key = category?.id ?? "without-category";
      const existing = categories.get(key) ?? {
        categoryId: category?.id ?? null,
        name: category?.name ?? "Sin categoria",
        revenue: 0,
        unitsSold: 0,
      };

      existing.revenue += item.price * item.quantity;
      existing.unitsSold += item.quantity;
      categories.set(key, existing);
    }
  }

  const items = sortByRevenueAndUnits(Array.from(categories.values())).map(
    (item, index) => ({
      ...item,
      revenue: round(item.revenue),
      color: CATEGORY_COLORS[index] ?? "gray",
    })
  );

  const totalRevenue = items.reduce((sum, item) => sum + item.revenue, 0);

  return {
    totalRevenue: round(totalRevenue),
    items: items.map((item) => ({
      ...item,
      percentage: totalRevenue > 0 ? round((item.revenue / totalRevenue) * 100) : 0,
    })),
  };
};

// Bajo/sin stock por tipo: VARIANTE mira cada variante activa (mismo criterio de
// siempre, umbral por variante); UNIDAD mira `Product.stock`; COMBO no tiene stock
// propio (depende de sus componentes) — no aplican etiquetas de stock, ver
// docs/servicios/dominio/Combos.md.
const resolveProductLabel = ({ product, metrics, isTopSeller, lowStockThreshold }) => {
  if (isTopSeller && metrics.unitsSold > 0) {
    return { key: "best_seller", label: "mas vendido", tone: "danger" };
  }

  if (product.type === "COMBO") {
    if (metrics.unitsSold === 0 && product.isActive) {
      return { key: "forgotten", label: "olvidado", tone: "info" };
    }
    return { key: "stable", label: "estable", tone: "neutral" };
  }

  if (product.type === "VARIANTE") {
    const activeVariants = product.variants.filter((variant) => variant.isActive);
    const hasLowStock = activeVariants.some(
      (variant) => variant.stock > 0 && variant.stock <= lowStockThreshold
    );
    const isOutOfStock =
      activeVariants.length > 0 && activeVariants.every((variant) => variant.stock <= 0);

    if (activeVariants.length === 0) {
      return { key: "no_variants", label: "sin variantes", tone: "warning" };
    }
    if (isOutOfStock) {
      return { key: "out_of_stock", label: "sin stock", tone: "danger" };
    }
    if (metrics.unitsSold === 0 && product.isActive) {
      return { key: "forgotten", label: "olvidado", tone: "info" };
    }
    if (hasLowStock) {
      return { key: "low_stock", label: "stock bajo", tone: "warning" };
    }
    return { key: "stable", label: "estable", tone: "neutral" };
  }

  // UNIDAD
  const stock = resolveProductStock(product, null) ?? 0;
  if (stock <= 0) {
    return { key: "out_of_stock", label: "sin stock", tone: "danger" };
  }
  if (metrics.unitsSold === 0 && product.isActive) {
    return { key: "forgotten", label: "olvidado", tone: "info" };
  }
  if (stock <= lowStockThreshold) {
    return { key: "low_stock", label: "stock bajo", tone: "warning" };
  }
  return { key: "stable", label: "estable", tone: "neutral" };
};

/**
 * Ranking de productos listo para UI.
 * Mezcla performance del periodo con etiquetas operativas relevantes.
 */
export const buildProductRanking = ({ orders, allProducts, lowStockThreshold }) => {
  const metricsByProduct = new Map();

  for (const order of orders) {
    if (!isCompletedOrder(order)) {
      continue;
    }

    for (const item of order.orderItems) {
      const product = item.product;

      if (!product) {
        continue;
      }

      const existing = metricsByProduct.get(product.id) ?? {
        revenue: 0,
        unitsSold: 0,
        orders: new Set(),
      };

      existing.revenue += item.price * item.quantity;
      existing.unitsSold += item.quantity;
      existing.orders.add(order.id);

      metricsByProduct.set(product.id, existing);
    }
  }

  const rankedBase = allProducts.map((product) => {
    const metrics = metricsByProduct.get(product.id) ?? {
      revenue: 0,
      unitsSold: 0,
      orders: new Set(),
    };

    return {
      productId: product.id,
      name: product.name,
      categoryName: product.category?.name ?? "Sin categoria",
      revenue: round(metrics.revenue),
      unitsSold: metrics.unitsSold,
      ordersCount: metrics.orders.size,
      variantsCount: product.variants.length,
      isActive: product.isActive,
      product,
    };
  });

  const soldProducts = sortByRevenueAndUnits(
    rankedBase.filter((item) => item.revenue > 0 || item.unitsSold > 0)
  );
  const topSellerId = soldProducts[0]?.productId ?? null;

  const ranked = rankedBase.map((item) => {
    const label = resolveProductLabel({
      product: item.product,
      metrics: item,
      isTopSeller: item.productId === topSellerId,
      lowStockThreshold,
    });

    return {
      productId: item.productId,
      name: item.name,
      categoryName: item.categoryName,
      revenue: item.revenue,
      unitsSold: item.unitsSold,
      ordersCount: item.ordersCount,
      variantsCount: item.variantsCount,
      label,
    };
  });

  const labelPriority = {
    best_seller: 0,
    low_stock: 1,
    out_of_stock: 2,
    forgotten: 3,
    no_variants: 4,
    stable: 5,
  };

  return ranked
    .sort((a, b) => {
      if (b.revenue !== a.revenue) {
        return b.revenue - a.revenue;
      }

      if (b.unitsSold !== a.unitsSold) {
        return b.unitsSold - a.unitsSold;
      }

      return labelPriority[a.label.key] - labelPriority[b.label.key];
    })
    .slice(0, 5)
    .map((item, index) => ({
      position: index + 1,
      ...item,
    }));
};
