import prisma from "../lib/prisma.js";
import { createError } from "../helpers/error.js";
import { generateSku } from "../utils/sku.js";
import { wrap, delPattern, hashParams, tenantNs } from "../lib/cache.js";
import { addDays, startOfDay } from "./stats/utils.js";
import {
  ANGLE_PREDICATES,
  WINDOW_DAYS,
} from "./content-suggestions/angles.js";

const PRODUCTS_LIST_TTL = 180;
const PRODUCT_DETAIL_TTL = 300;
const VARIANT_OPTIONS_TTL = 600;

function productsListKey(tenantId, params, isAdmin) {
  const filteredParams = { ...params, includeInactive: isAdmin };
  return `${tenantNs(tenantId)}:prod:list:${hashParams(filteredParams)}`;
}

function productDetailKey(tenantId, productId) {
  return `${tenantNs(tenantId)}:prod:detail:${productId}`;
}

function variantOptionsKey(tenantId) {
  return `${tenantNs(tenantId)}:prod:options`;
}

async function invalidateProductsCache(tenantId) {
  await delPattern(`${tenantNs(tenantId)}:prod:*`);
}

// Filtro de atributos de variante (color/talla). Se usa tanto para decidir qué
// productos matchean como para qué variantes incluir en la respuesta.
const buildVariantAttributeFilter = ({ color, size }) => {
  const filter = { isActive: true };
  if (color) filter.color = color;
  if (size) filter.size = size;
  return filter;
};

const buildPriceRange = ({ minPrice, maxPrice }) => {
  const range = {};
  if (minPrice !== undefined) range.gte = minPrice;
  if (maxPrice !== undefined) range.lte = maxPrice;
  return Object.keys(range).length ? range : null;
};

// Construye el WHERE de producto contemplando el "precio efectivo":
// variante.price si existe, o product.price como fallback (productos unitarios).
const buildProductWhere = ({
  base,
  color,
  size,
  minPrice,
  maxPrice,
}) => {
  const where = { ...base };
  const attributeFilter = buildVariantAttributeFilter({ color, size });
  const hasAttributeFilter = Boolean(color || size);
  const priceRange = buildPriceRange({ minPrice, maxPrice });
  const and = [];

  if (hasAttributeFilter) {
    and.push({ variants: { some: attributeFilter } });
  }

  if (priceRange) {
    and.push({
      OR: [
        // La variante tiene su propio precio dentro del rango.
        { variants: { some: { ...attributeFilter, price: priceRange } } },
        // La variante no tiene precio: aplica el precio del producto.
        {
          price: priceRange,
          variants: { some: { ...attributeFilter, price: null } },
        },
        // Producto unitario (sin variantes): aplica el precio del producto.
        ...(hasAttributeFilter
          ? []
          : [{ price: priceRange, variants: { none: {} } }]),
      ],
    });
  }

  if (and.length) {
    where.AND = and;
  }

  return { where, attributeFilter };
};

const ensureCategoryExists = async (tenantId, categoryId) => {
  if (categoryId === undefined || categoryId === null) return;

  const category = await prisma.categories.findFirst({
    where: { id: categoryId, tenantId },
    select: { id: true },
  });

  if (!category) {
    throw createError("La categoría no existe", "CATEGORY_NOT_FOUND", 404);
  }
};

// Combos: valida la whitelist antes de persistirla. `comboProductId` es null en
// `create` (el combo todavía no tiene id) — el self-check no aplica ahí.
const ensureComboOptionsValid = async (tenantId, comboOptions, comboProductId = null) => {
  if (!comboOptions.length) return;

  const ids = comboOptions.map((o) => o.allowedProductId);
  if (comboProductId != null && ids.includes(comboProductId)) {
    throw createError(
      "Un combo no puede permitirse a sí mismo",
      "COMBO_PRODUCT_NOT_ALLOWED",
      400
    );
  }

  const products = await prisma.product.findMany({
    where: { id: { in: ids }, tenantId },
    select: { id: true, isCombo: true },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  for (const id of ids) {
    const product = productMap.get(id);
    if (!product) {
      throw createError(
        "Uno de los productos permitidos no existe",
        "PRODUCT_NOT_FOUND",
        404
      );
    }
    if (product.isCombo) {
      throw createError(
        "No se permiten combos anidados",
        "COMBO_NESTED_NOT_ALLOWED",
        400
      );
    }
  }
};

const generateUniqueVariantSku = async ({ tenantId, productName, reservedSkus = new Set() }) => {
  let sku;

  do {
    sku = generateSku({ productName });
  } while (
    reservedSkus.has(sku) ||
    (await prisma.productVariant.findUnique({
      where: { tenantId_sku: { tenantId, sku } },
      select: { id: true },
    }))
  );

  reservedSkus.add(sku);
  return sku;
};

export const ProductModel = {
  async getAll({
    tenantId,
    name,
    categoryId,
    variantColor,
    variantSize,
    minPrice,
    maxPrice,
    limit,
    offset,
    includeInactive = false,
  }) {
    const params = {
      name,
      categoryId,
      variantColor,
      variantSize,
      minPrice,
      maxPrice,
      limit,
      offset,
    };
    const key = productsListKey(tenantId, params, includeInactive);

    return wrap(key, PRODUCTS_LIST_TTL, async () => {
      const base = { tenantId };

      if (!includeInactive) {
        base.isActive = true;
      }
      if (name) {
        base.name = { contains: name, mode: "insensitive" };
      }

      if (Array.isArray(categoryId)) {
        if (categoryId.length) base.categoryId = { in: categoryId };
      } else if (categoryId !== undefined) {
        base.categoryId = categoryId;
      }

      const { where, attributeFilter } = buildProductWhere({
        base,
        color: variantColor,
        size: variantSize,
        minPrice,
        maxPrice,
      });

      return prisma.product.findMany({
        where,
        include: {
          variants: {
            where: attributeFilter,
            orderBy: { id: "asc" },
          },
        },
        take: limit,
        skip: offset,
        orderBy: { id: "asc" },
      });
    });
  },

  /**
   * Productos destacados por ÁNGULO de marketing (BEST_SELLER, NEW_ARRIVAL, ...).
   * Reusa `ANGLE_PREDICATES` (fuente única compartida con Sugerencias): enriquece el
   * catálogo activo con las unidades vendidas en COMPLETED dentro de la ventana, filtra
   * con el predicado del ángulo y ordena con el sentido de ese ángulo. Devuelve productos
   * completos (con variants) para que el storefront renderice las cartas. Sin cache:
   * depende de ventas, refleja al toque. El precio/stock se resuelven server-side.
   */
  async getByAngle({ tenantId, angle, limit = 4 }) {
    const predicate = ANGLE_PREDICATES[angle];
    if (!predicate) {
      throw createError("Ángulo inválido", "INVALID_ANGLE", 400);
    }

    const now = new Date();
    const windowStart = startOfDay(addDays(now, -(WINDOW_DAYS - 1)));

    const [products, completedOrders] = await Promise.all([
      prisma.product.findMany({
        where: { tenantId, isActive: true },
        include: {
          variants: { where: { isActive: true }, orderBy: { id: "asc" } },
        },
        orderBy: { id: "asc" },
      }),
      prisma.order.findMany({
        where: {
          tenantId,
          status: "COMPLETED",
          createdAt: { gte: windowStart, lte: now },
        },
        select: {
          orderItems: {
            select: {
              quantity: true,
              variant: { select: { productId: true } },
            },
          },
        },
      }),
    ]);

    const unitsByProduct = new Map();
    for (const order of completedOrders) {
      for (const item of order.orderItems) {
        const pid = item.variant?.productId;
        if (pid == null) continue;
        unitsByProduct.set(pid, (unitsByProduct.get(pid) ?? 0) + item.quantity);
      }
    }

    // Sentido de orden por ángulo (mismo criterio que ANGLE_SELECTORS, pero para una lista).
    const sorters = {
      BEST_SELLER: (a, b) => b.units - a.units,
      LOW_STOCK: (a, b) => b.units - a.units,
      NEW_ARRIVAL: (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      NO_RECENT_SALES: (a, b) => a.id - b.id,
    };
    const sorter = sorters[angle] ?? ((a, b) => a.id - b.id);

    return products
      .map((product) => ({ ...product, units: unitsByProduct.get(product.id) ?? 0 }))
      .filter((product) => predicate(product, now))
      .sort(sorter)
      .slice(0, limit)
      // eslint-disable-next-line no-unused-vars
      .map(({ units, ...product }) => product);
  },

  async getVariantOptions({ tenantId }) {
    const key = variantOptionsKey(tenantId);

    return wrap(key, VARIANT_OPTIONS_TTL, async () => {
      const [colors, sizes] = await Promise.all([
        prisma.productVariant.findMany({
          where: { tenantId, isActive: true, color: { not: null } },
          select: { color: true },
          distinct: ["color"],
          orderBy: { color: "asc" },
        }),
        prisma.productVariant.findMany({
          where: { tenantId, isActive: true, size: { not: null } },
          select: { size: true },
          distinct: ["size"],
          orderBy: { size: "asc" },
        }),
      ]);

      return {
        colors: colors.map((variant) => variant.color),
        sizes: sizes.map((variant) => variant.size),
      };
    });
  },

  /**
   * Agregados del catálogo para las stat cards del header de Productos.
   * El stock vive en las variantes (los productos "sin variantes" tienen una
   * variante única), así que bajo/agotado se computa sumando stock de
   * variantes activas por producto activo.
   */
  async getStats({ tenantId, lowStockThreshold = 5 }) {
    const key = `${tenantNs(tenantId)}:prod:stats:${lowStockThreshold}`;

    return wrap(key, PRODUCTS_LIST_TTL, async () => {
      const [total, activeProducts, stockByProduct] = await Promise.all([
        prisma.product.count({ where: { tenantId } }),
        prisma.product.findMany({
          where: { tenantId, isActive: true },
          select: { id: true },
        }),
        prisma.productVariant.groupBy({
          by: ["productId"],
          where: { tenantId, isActive: true, product: { isActive: true } },
          _sum: { stock: true },
        }),
      ]);

      const stockOf = new Map(
        stockByProduct.map((row) => [row.productId, row._sum.stock ?? 0])
      );

      let lowStock = 0;
      let outOfStock = 0;
      for (const { id } of activeProducts) {
        const stock = stockOf.get(id) ?? 0;
        if (stock === 0) outOfStock += 1;
        else if (stock <= lowStockThreshold) lowStock += 1;
      }

      return {
        total,
        active: activeProducts.length,
        lowStock,
        outOfStock,
        lowStockThreshold,
      };
    });
  },

  async getById({ tenantId, id }) {
    const key = productDetailKey(tenantId, id);

    return wrap(key, PRODUCT_DETAIL_TTL, async () => {
      const product = await prisma.product.findFirst({
        where: { id, tenantId },
        include: {
          variants: {
            where: { isActive: true },
            orderBy: { id: "asc" },
          },
        },
      });

      if (!product) {
        throw createError("Producto no encontrado", "PRODUCT_NOT_FOUND", 404);
      }

      return product;
    });
  },

  async getByIdForManagement({ tenantId, id }) {
    const product = await prisma.product.findFirst({
      where: { id, tenantId },
      include: {
        variants: {
          orderBy: { id: "asc" },
        },
      },
    });

    if (!product) {
      throw createError("Producto no encontrado", "PRODUCT_NOT_FOUND", 404);
    }

    return product;
  },

  async create({
    tenantId,
    name,
    description,
    categoryId,
    price,
    img,
    imgPublicId,
    isActive,
    variants = [],
    stock,
    isCombo = false,
    comboMinItems,
    comboMaxItems,
    comboOptions = [],
  }) {
    await ensureCategoryExists(tenantId, categoryId);
    if (isCombo) {
      await ensureComboOptionsValid(tenantId, comboOptions);
    }

    const reservedSkus = new Set();
    let variantsWithSku = await Promise.all(
      variants.map(async (variant) => ({
        ...variant,
        sku: await generateUniqueVariantSku({
          tenantId,
          productName: name,
          reservedSkus,
        }),
      }))
    );

    // Producto sin variantes reales (ej. Mesa Dulce): stock/sku viven solo en
    // ProductVariant, así que se crea una variante default (color/size null)
    // para que el producto sea vendible por el flujo de carrito/órdenes.
    if (variantsWithSku.length === 0) {
      if (stock === undefined) {
        throw createError(
          "El stock es requerido para un producto sin variantes",
          "STOCK_REQUIRED",
          400
        );
      }

      variantsWithSku = [
        {
          color: null,
          size: null,
          price: null,
          stock,
          sku: await generateUniqueVariantSku({
            tenantId,
            productName: name,
            reservedSkus,
          }),
          img: null,
          imgPublicId: null,
          isActive: true,
        },
      ];
    }

    const data = {
      tenantId,
      name,
      description: description ?? null,
      categoryId: categoryId ?? null,
      price,
      img: img ?? null,
      imgPublicId: imgPublicId ?? null,
      isActive: isActive ?? true,
      isCombo,
      comboMinItems: isCombo ? comboMinItems ?? null : null,
      comboMaxItems: isCombo ? comboMaxItems ?? null : null,
    };

    const result = await prisma.product.create({
      data: {
        ...data,
        variants:
          variantsWithSku.length > 0
            ? {
                create: variantsWithSku.map((variant) => ({
                  tenantId,
                  color: variant.color ?? null,
                  size: variant.size ?? null,
                  price: variant.price ?? null,
                  stock: variant.stock,
                  sku: variant.sku,
                  img: variant.img ?? null,
                  imgPublicId: variant.imgPublicId ?? null,
                  isActive: variant.isActive ?? true,
                })),
              }
            : undefined,
        comboOptions:
          isCombo && comboOptions.length
            ? {
                create: comboOptions.map((option) => ({
                  tenantId,
                  allowedProductId: option.allowedProductId,
                  minQty: option.minQty ?? 0,
                  maxQty: option.maxQty ?? null,
                })),
              }
            : undefined,
      },
      include: {
        variants: {
          orderBy: { id: "asc" },
        },
        comboOptions: true,
      },
    });

    await invalidateProductsCache(tenantId);
    return result;
  },

  async edit(
    { tenantId, id },
    {
      name,
      description,
      categoryId,
      price,
      img,
      imgPublicId,
      isActive,
      stock,
      isCombo,
      comboMinItems,
      comboMaxItems,
      comboOptions,
    }
  ) {
    const existing = await this.getByIdForManagement({ tenantId, id });
    await ensureCategoryExists(tenantId, categoryId);

    if (comboOptions !== undefined) {
      await ensureComboOptionsValid(tenantId, comboOptions, id);
    }

    const data = {
      name,
      description,
      categoryId,
      price,
      img,
      imgPublicId,
      isActive,
      isCombo,
      comboMinItems,
      comboMaxItems,
    };

    const updateData = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined)
    );

    // `stock` solo aplica a productos sin variantes reales (la variante default
    // color/size null creada en `create`); en cualquier otro caso se ignora.
    if (stock !== undefined) {
      const defaultVariant =
        existing.variants.length === 1 &&
        existing.variants[0].color === null &&
        existing.variants[0].size === null
          ? existing.variants[0]
          : null;

      if (defaultVariant) {
        await prisma.productVariant.update({
          where: { id: defaultVariant.id },
          data: { stock },
        });
      }
    }

    // `comboOptions` reemplaza la whitelist completa (no hay merge incremental
    // en v1): borra las reglas actuales y crea las nuevas en una transacción.
    if (comboOptions !== undefined) {
      await prisma.$transaction([
        prisma.comboAllowedProduct.deleteMany({ where: { comboProductId: id } }),
        ...(comboOptions.length
          ? [
              prisma.comboAllowedProduct.createMany({
                data: comboOptions.map((option) => ({
                  tenantId,
                  comboProductId: id,
                  allowedProductId: option.allowedProductId,
                  minQty: option.minQty ?? 0,
                  maxQty: option.maxQty ?? null,
                })),
              }),
            ]
          : []),
      ]);
    }

    const result = await prisma.product.update({
      where: { id },
      data: updateData,
      include: {
        variants: {
          where: { isActive: true },
          orderBy: { id: "asc" },
        },
        comboOptions: true,
      },
    });

    await invalidateProductsCache(tenantId);
    return result;
  },

  async getComboOptions({ tenantId, id }) {
    const key = `${tenantNs(tenantId)}:prod:combo:${id}`;

    return wrap(key, PRODUCT_DETAIL_TTL, async () => {
      const product = await prisma.product.findFirst({
        where: { id, tenantId },
        select: { id: true, isCombo: true, comboMinItems: true, comboMaxItems: true },
      });

      if (!product) {
        throw createError("Producto no encontrado", "PRODUCT_NOT_FOUND", 404);
      }
      if (!product.isCombo) {
        throw createError("El producto no es un combo", "PRODUCT_NOT_COMBO", 400);
      }

      const options = await prisma.comboAllowedProduct.findMany({
        where: { comboProductId: id, tenantId, isActive: true },
        include: {
          allowedProduct: {
            include: {
              variants: { where: { isActive: true }, orderBy: { id: "asc" } },
            },
          },
        },
      });

      return {
        comboMinItems: product.comboMinItems,
        comboMaxItems: product.comboMaxItems,
        allowedProducts: options
          .filter((option) => option.allowedProduct.isActive)
          .map((option) => ({
            productId: option.allowedProduct.id,
            name: option.allowedProduct.name,
            img: option.allowedProduct.img,
            price: option.allowedProduct.price,
            minQty: option.minQty,
            maxQty: option.maxQty,
            variants: option.allowedProduct.variants.map((variant) => ({
              id: variant.id,
              color: variant.color,
              size: variant.size,
              stock: variant.stock,
            })),
          })),
      };
    });
  },

  async assignCategory({ tenantId, id, categoryId }) {
    await this.getByIdForManagement({ tenantId, id });
    await ensureCategoryExists(tenantId, categoryId);

    const result = await prisma.product.update({
      where: { id },
      data: { categoryId },
      include: {
        variants: {
          where: { isActive: true },
          orderBy: { id: "asc" },
        },
      },
    });

    await invalidateProductsCache(tenantId);
    return result;
  },

  async delete({ tenantId, id }) {
    await this.getByIdForManagement({ tenantId, id });

    const result = await prisma.product.delete({
      where: { id },
    });

    await invalidateProductsCache(tenantId);
    return result;
  },
};
