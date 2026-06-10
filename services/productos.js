import prisma from "../lib/prisma.js";
import { createError } from "../helpers/error.js";
import { generateSku } from "../utils/sku.js";
import { wrap, delPattern, hashParams, tenantNs } from "../lib/cache.js";

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

      if (categoryId !== undefined) {
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
  }) {
    await ensureCategoryExists(tenantId, categoryId);

    const reservedSkus = new Set();
    const variantsWithSku = await Promise.all(
      variants.map(async (variant) => ({
        ...variant,
        sku: await generateUniqueVariantSku({
          tenantId,
          productName: name,
          reservedSkus,
        }),
      }))
    );

    const data = {
      tenantId,
      name,
      description: description ?? null,
      categoryId: categoryId ?? null,
      price,
      img: img ?? null,
      imgPublicId: imgPublicId ?? null,
      isActive: isActive ?? true,
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
      },
      include: {
        variants: {
          orderBy: { id: "asc" },
        },
      },
    });

    await invalidateProductsCache(tenantId);
    return result;
  },

  async edit(
    { tenantId, id },
    { name, description, categoryId, price, img, imgPublicId, isActive }
  ) {
    await this.getByIdForManagement({ tenantId, id });
    await ensureCategoryExists(tenantId, categoryId);

    const data = {
      name,
      description,
      categoryId,
      price,
      img,
      imgPublicId,
      isActive,
    };

    const updateData = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined)
    );

    const result = await prisma.product.update({
      where: { id },
      data: updateData,
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
