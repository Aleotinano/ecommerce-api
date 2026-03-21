import prisma from "../lib/prisma.js";
import { createError } from "../helpers/error.js";
import { generateSku } from "../utils/sku.js";

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
    sku,
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

    const resolvedSku =
      sku?.trim() || generateSku({ productName: product.name });

    const existing = await prisma.productVariant.findFirst({
      where: { productId, sku: resolvedSku },
    });

    if (existing) {
      if (sku?.trim()) {
        throw createError(
          "Ya existe una variante con ese SKU",
          "SKU_DUPLICATE",
          409
        );
      }
      return this.createVariant({
        productId,
        color,
        size,
        price,
        stock,
        sku: generateSku({ productName: product.name }),
        img,
        imgPublicId,
        isActive,
      });
    }

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
    { color, size, price, stock, sku, img, imgPublicId, isActive }
  ) {
    const variant = await this.getByIdForManagement({ productId, variantId });

    if (sku && sku !== variant.sku) {
      const duplicate = await prisma.productVariant.findFirst({
        where: { productId, sku, NOT: { id: variantId } },
      });

      if (duplicate) {
        throw createError(
          "Ya existe una variante con ese SKU",
          "SKU_DUPLICATE",
          409
        );
      }
    }

    const data = { color, size, price, stock, sku, img, imgPublicId, isActive };
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
