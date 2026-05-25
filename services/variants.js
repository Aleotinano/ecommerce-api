import prisma from "../lib/prisma.js";
import { createError } from "../helpers/error.js";
import { generateSku } from "../utils/sku.js";

const generateUniqueVariantSku = async ({
  tenantId,
  productName,
  reservedSkus = new Set(),
}) => {
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

export const VariantModel = {
  async getVariants({ tenantId, productId }) {
    const product = await prisma.product.findFirst({
      where: { id: productId, tenantId },
      include: {
        variants: { orderBy: { id: "asc" } },
      },
    });

    if (!product) {
      throw createError("Producto no encontrado", "PRODUCT_NOT_FOUND", 404);
    }

    return product.variants;
  },

  async getByIdForManagement({ tenantId, productId, variantId }) {
    const variant = await prisma.productVariant.findFirst({
      where: { id: variantId, productId, tenantId },
    });

    if (!variant) {
      throw createError("Variante no encontrada", "VARIANT_NOT_FOUND", 404);
    }

    return variant;
  },

  async createVariant({
    tenantId,
    productId,
    color,
    size,
    price,
    stock,
    img,
    imgPublicId,
    isActive,
  }) {
    const product = await prisma.product.findFirst({
      where: { id: productId, tenantId },
      select: { name: true },
    });

    if (!product) {
      throw createError("Producto no encontrado", "PRODUCT_NOT_FOUND", 404);
    }

    const sku = await generateUniqueVariantSku({
      tenantId,
      productName: product.name,
    });

    return prisma.productVariant.create({
      data: {
        tenantId,
        productId,
        color: color ?? null,
        size: size ?? null,
        price,
        stock,
        sku,
        img: img ?? null,
        imgPublicId: imgPublicId ?? null,
        isActive: isActive ?? true,
      },
    });
  },

  async editVariant(
    { tenantId, productId, variantId },
    { color, size, price, stock, img, imgPublicId, isActive }
  ) {
    await this.getByIdForManagement({ tenantId, productId, variantId });

    const updateData = Object.fromEntries(
      Object.entries({
        color,
        size,
        price,
        stock,
        img,
        imgPublicId,
        isActive,
      }).filter(([, value]) => value !== undefined)
    );

    return prisma.productVariant.update({
      where: { id: variantId },
      data: updateData,
    });
  },

  async deleteVariant({ tenantId, productId, variantId }) {
    await this.getByIdForManagement({ tenantId, productId, variantId });
    return prisma.productVariant.delete({ where: { id: variantId } });
  },
};
