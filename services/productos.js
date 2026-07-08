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

// Construye el WHERE de producto por tipo: VARIANTE resuelve precio/atributos contra
// ProductVariant; UNIDAD/COMBO contra las columnas propias de Product. Un filtro de
// color/talle excluye UNIDAD/COMBO (no tienen esos atributos).
const buildProductWhere = ({ base, color, size, minPrice, maxPrice }) => {
  const where = { ...base };
  const attributeFilter = buildVariantAttributeFilter({ color, size });
  const hasAttributeFilter = Boolean(color || size);
  const priceRange = buildPriceRange({ minPrice, maxPrice });
  const and = [];

  if (hasAttributeFilter) {
    and.push({ type: "VARIANTE", variants: { some: attributeFilter } });
  }

  if (priceRange) {
    and.push({
      OR: [
        // VARIANTE: precio de alguna variante activa (que además matchee el filtro de atributos si hay).
        { type: "VARIANTE", variants: { some: { ...attributeFilter, price: priceRange } } },
        // UNIDAD/COMBO: precio propio del producto. No aplica si hay filtro de atributos
        // (esos tipos no tienen color/talle).
        ...(hasAttributeFilter
          ? []
          : [{ type: { in: ["UNIDAD", "COMBO"] }, price: priceRange }]),
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
    select: { id: true, type: true },
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
    if (product.type === "COMBO") {
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

const buildVariantsWithSku = async ({ tenantId, productName, variants }) => {
  const reservedSkus = new Set();
  return Promise.all(
    variants.map(async (variant) => ({
      ...variant,
      sku: await generateUniqueVariantSku({ tenantId, productName, reservedSkus }),
    }))
  );
};

const toVariantCreateData = (tenantId, variant) => ({
  tenantId,
  color: variant.color ?? null,
  size: variant.size ?? null,
  price: variant.price ?? null,
  stock: variant.stock,
  sku: variant.sku,
  img: variant.img ?? null,
  imgPublicId: variant.imgPublicId ?? null,
  isActive: variant.isActive ?? true,
});

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
              productId: true,
              variant: { select: { productId: true } },
            },
          },
        },
      }),
    ]);

    const unitsByProduct = new Map();
    for (const order of completedOrders) {
      for (const item of order.orderItems) {
        const pid = item.productId ?? item.variant?.productId;
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
          where: {
            tenantId,
            isActive: true,
            color: { not: null },
            product: { type: "VARIANTE" },
          },
          select: { color: true },
          distinct: ["color"],
          orderBy: { color: "asc" },
        }),
        prisma.productVariant.findMany({
          where: {
            tenantId,
            isActive: true,
            size: { not: null },
            product: { type: "VARIANTE" },
          },
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
   * Agregados del catálogo para las stat cards del header de Productos. El stock vive
   * en `Product.stock` para UNIDAD y en `ProductVariant.stock` para VARIANTE; COMBO no
   * tiene stock propio (se excluye de bajo/sin stock, pero cuenta en total/activos).
   */
  async getStats({ tenantId, lowStockThreshold = 5 }) {
    const key = `${tenantNs(tenantId)}:prod:stats:${lowStockThreshold}`;

    return wrap(key, PRODUCTS_LIST_TTL, async () => {
      const [total, activeProducts, stockByVariantProduct] = await Promise.all([
        prisma.product.count({ where: { tenantId } }),
        prisma.product.findMany({
          where: { tenantId, isActive: true },
          select: { id: true, type: true, stock: true },
        }),
        prisma.productVariant.groupBy({
          by: ["productId"],
          where: {
            tenantId,
            isActive: true,
            product: { isActive: true, type: "VARIANTE" },
          },
          _sum: { stock: true },
        }),
      ]);

      const variantStockOf = new Map(
        stockByVariantProduct.map((row) => [row.productId, row._sum.stock ?? 0])
      );

      let lowStock = 0;
      let outOfStock = 0;
      for (const product of activeProducts) {
        if (product.type === "COMBO") continue;

        const stock =
          product.type === "VARIANTE"
            ? variantStockOf.get(product.id) ?? 0
            : product.stock ?? 0;

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
    type,
    variants = [],
    stock,
    comboMinItems,
    comboMaxItems,
    comboOptions = [],
  }) {
    await ensureCategoryExists(tenantId, categoryId);

    let variantsWithSku = [];

    if (type === "UNIDAD") {
      if (variants.length > 0) {
        throw createError(
          "Un producto UNIDAD no admite variantes",
          "VARIANTS_NOT_ALLOWED",
          400
        );
      }
      if (stock === undefined) {
        throw createError(
          "El stock es requerido para un producto UNIDAD",
          "STOCK_REQUIRED",
          400
        );
      }
    } else if (type === "VARIANTE") {
      if (variants.length === 0) {
        throw createError(
          "Un producto VARIANTE necesita al menos una variante",
          "VARIANTS_REQUIRED",
          400
        );
      }
      variantsWithSku = await buildVariantsWithSku({ tenantId, productName: name, variants });
    } else if (type === "COMBO") {
      if (variants.length > 0) {
        throw createError("Un combo no admite variantes", "VARIANTS_NOT_ALLOWED", 400);
      }
      if (comboMinItems == null || comboMaxItems == null) {
        throw createError(
          "comboMinItems y comboMaxItems son requeridos para un combo",
          "COMBO_RANGE_REQUIRED",
          400
        );
      }
      await ensureComboOptionsValid(tenantId, comboOptions);
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
      type,
      stock: type === "UNIDAD" ? stock : null,
      isCombo: type === "COMBO",
      comboMinItems: type === "COMBO" ? comboMinItems ?? null : null,
      comboMaxItems: type === "COMBO" ? comboMaxItems ?? null : null,
    };

    const result = await prisma.product.create({
      data: {
        ...data,
        variants:
          variantsWithSku.length > 0
            ? { create: variantsWithSku.map((variant) => toVariantCreateData(tenantId, variant)) }
            : undefined,
        comboOptions:
          type === "COMBO" && comboOptions.length
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
      type,
      stock,
      variants,
      comboMinItems,
      comboMaxItems,
      comboOptions,
    }
  ) {
    const existing = await this.getByIdForManagement({ tenantId, id });
    await ensureCategoryExists(tenantId, categoryId);

    const currentType = existing.type;
    const targetType = type ?? currentType;
    const isTypeChange = type !== undefined && type !== currentType;

    if (targetType === "COMBO" && comboOptions !== undefined) {
      await ensureComboOptionsValid(tenantId, comboOptions, id);
    }

    // Transición de tipo: desactiva (nunca borra) lo que deja de aplicar — por
    // integridad de OrderItem históricos que puedan referenciarlo.
    if (isTypeChange) {
      if (currentType === "VARIANTE") {
        await prisma.productVariant.updateMany({
          where: { productId: id, isActive: true },
          data: { isActive: false },
        });
      }
      if (currentType === "COMBO" && targetType !== "COMBO") {
        await prisma.comboAllowedProduct.updateMany({
          where: { comboProductId: id, isActive: true },
          data: { isActive: false },
        });
      }
    }

    if (targetType === "VARIANTE") {
      const willHaveActiveVariants =
        Array.isArray(variants) && variants.length > 0
          ? true
          : !isTypeChange && existing.variants.some((v) => v.isActive);
      if (!willHaveActiveVariants) {
        throw createError(
          "Un producto VARIANTE necesita al menos una variante",
          "VARIANTS_REQUIRED",
          400
        );
      }
    }

    if (targetType === "UNIDAD" && isTypeChange && stock === undefined) {
      throw createError(
        "El stock es requerido al pasar un producto a UNIDAD",
        "STOCK_REQUIRED",
        400
      );
    }

    let newVariants;
    if (targetType === "VARIANTE" && Array.isArray(variants) && variants.length > 0) {
      newVariants = await buildVariantsWithSku({
        tenantId,
        productName: existing.name,
        variants,
      });
    }

    const data = {
      name,
      description,
      categoryId,
      price,
      img,
      imgPublicId,
      isActive,
      type,
      stock: targetType === "UNIDAD" ? stock : undefined,
      isCombo: type !== undefined ? targetType === "COMBO" : undefined,
      comboMinItems:
        targetType === "COMBO" ? comboMinItems : isTypeChange ? null : undefined,
      comboMaxItems:
        targetType === "COMBO" ? comboMaxItems : isTypeChange ? null : undefined,
    };

    const updateData = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined)
    );

    if (newVariants) {
      updateData.variants = {
        create: newVariants.map((variant) => toVariantCreateData(tenantId, variant)),
      };
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
        select: { id: true, type: true, comboMinItems: true, comboMaxItems: true },
      });

      if (!product) {
        throw createError("Producto no encontrado", "PRODUCT_NOT_FOUND", 404);
      }
      if (product.type !== "COMBO") {
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
            type: option.allowedProduct.type,
            price: option.allowedProduct.price,
            // Solo UNIDAD tiene stock propio a nivel producto; VARIANTE lo trae por
            // variante en `variants[]`, COMBO no es elegible como componente.
            stock: option.allowedProduct.type === "UNIDAD" ? option.allowedProduct.stock : null,
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
