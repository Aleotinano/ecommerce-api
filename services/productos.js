import prisma from "../lib/prisma.js";
import { createError } from "../helpers/error.js";

const buildVariantFilter = ({ color, size, minPrice, maxPrice }) => {
  const filter = { isActive: true };
  let hasAdditionalCriteria = false;

  if (color) {
    filter.color = color;
    hasAdditionalCriteria = true;
  }

  if (size) {
    filter.size = size;
    hasAdditionalCriteria = true;
  }

  const priceFilter = {};
  if (minPrice !== undefined) {
    priceFilter.gte = minPrice;
  }

  if (maxPrice !== undefined) {
    priceFilter.lte = maxPrice;
  }

  if (Object.keys(priceFilter).length) {
    filter.price = priceFilter;
    hasAdditionalCriteria = true;
  }

  return { filter, hasAdditionalCriteria };
};

export const ProductModel = {
  async getAll({
    name,
    categoryId,
    variantColor,
    variantSize,
    minPrice,
    maxPrice,
    limit,
    offset,
  }) {
    const where = { isActive: true };

    if (name) {
      where.name = { contains: name, mode: "insensitive" };
    }

    if (categoryId !== undefined) {
      where.categoryId = categoryId;
    }

    const { filter: variantFilter, hasAdditionalCriteria } = buildVariantFilter(
      {
        color: variantColor,
        size: variantSize,
        minPrice,
        maxPrice,
      }
    );

    if (hasAdditionalCriteria) {
      where.variants = { some: variantFilter };
    }

    return prisma.product.findMany({
      where,
      include: {
        variants: {
          where: variantFilter,
          orderBy: { id: "asc" },
        },
      },
      take: limit,
      skip: offset,
      orderBy: { id: "asc" },
    });
  },

  async getVariantOptions() {
    const [colors, sizes] = await Promise.all([
      prisma.productVariant.findMany({
        where: { isActive: true, color: { not: null } },
        select: { color: true },
        distinct: ["color"],
        orderBy: { color: "asc" },
      }),
      prisma.productVariant.findMany({
        where: { isActive: true, size: { not: null } },
        select: { size: true },
        distinct: ["size"],
        orderBy: { size: "asc" },
      }),
    ]);

    return {
      colors: colors.map((v) => v.color),
      sizes: sizes.map((v) => v.size),
    };
  },

  async getById({ id }) {
    const product = await prisma.product.findFirst({
      where: { id, isActive: true },
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
  },

  async create({ name, description, categoryId, img, isActive, variants }) {
    const data = {
      name,
      description: description ?? null,
      categoryId: categoryId ?? null,
      img: img ?? null,
      isActive: isActive ?? true,
    };

    return prisma.product.create({
      data: {
        ...data,
        variants: {
          create: variants.map((variant) => ({
            color: variant.color,
            size: variant.size,
            price: variant.price,
            stock: variant.stock,
            sku: variant.sku,
            img: variant.img ?? null,
            isActive: variant.isActive ?? true,
          })),
        },
      },
      include: {
        variants: {
          orderBy: { id: "asc" },
        },
      },
    });
  },

  async edit({ id }, { name, description, categoryId, img, isActive }) {
    const existing = await prisma.product.findUnique({
      where: { id },
    });

    if (!existing) {
      throw createError("Producto no encontrado", "PRODUCT_NOT_FOUND", 404);
    }

    const data = {
      name,
      description,
      categoryId,
      img,
      isActive,
    };

    const updateData = Object.fromEntries(
      Object.entries(data).filter(([_, value]) => value !== undefined)
    );

    return prisma.product.update({
      where: { id },
      data: updateData,
      include: {
        variants: {
          where: { isActive: true },
          orderBy: { id: "asc" },
        },
      },
    });
  },

  async delete({ id }) {
    const existing = await prisma.product.findUnique({
      where: { id },
    });

    if (!existing) {
      throw createError("Producto no encontrado", "PRODUCT_NOT_FOUND", 404);
    }

    return prisma.product.delete({
      where: { id },
    });
  },
};
