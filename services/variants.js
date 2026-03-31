import prisma from "../lib/prisma.js";
import { createError } from "../helpers/error.js";
import { generateSku } from "../utils/sku.js";

const generateUniqueVariantSku = async ({ productName, reservedSkus = new Set() }) => {
  let sku;

  do {
    sku = generateSku({ productName });
  } while (
    reservedSkus.has(sku) ||
    (await prisma.productVariant.findUnique({
      where: { sku },
      select: { id: true },
    }))
  );

  reservedSkus.add(sku);
  return sku;
};

export const VariantModel = {
  async getVariants({ productId }) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      throw createError("Producto no encontrado", "PRODUCT_NOT_FOUND", 404);
    }

    return prisma.productVariant.findMany({
      where: { productId },
      orderBy: { id: "asc" },
    });
  },

  async getByIdForManagement({ productId, variantId }) {
    const variant = await prisma.productVariant.findFirst({
      where: { id: variantId, productId },
    });

    if (!variant) {
      throw createError("Variante no encontrada", "VARIANT_NOT_FOUND", 404);
    }

    return variant;
  },

  async createVariant({
    productId,
    color,
    size,
    price,
    stock,
    img,
    imgPublicId,
    isActive,
  }) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      throw createError("Producto no encontrado", "PRODUCT_NOT_FOUND", 404);
    }

    const resolvedSku = await generateUniqueVariantSku({
      productName: product.name,
    });

    return prisma.productVariant.create({
      data: {
        productId,
        color: color ?? null,
        size: size ?? null,
        price,
        stock,
        sku: resolvedSku,
        img: img ?? null,
        imgPublicId: imgPublicId ?? null,
        isActive: isActive ?? true,
      },
    });
  },

  async editVariant(
    { productId, variantId },
    { color, size, price, stock, img, imgPublicId, isActive }
  ) {
    await this.getByIdForManagement({ productId, variantId });

    const data = { color, size, price, stock, img, imgPublicId, isActive };
    const updateData = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined)
    );

    return prisma.productVariant.update({
      where: { id: variantId },
      data: updateData,
    });
  },

  async deleteVariant({ productId, variantId }) {
    await this.getByIdForManagement({ productId, variantId });

    return prisma.productVariant.delete({
      where: { id: variantId },
    });
  },
};
