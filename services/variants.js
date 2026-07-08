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

const ensureProductIsVariante = async (tenantId, productId) => {
  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId },
    select: { id: true, name: true, type: true },
  });

  if (!product) {
    throw createError("Producto no encontrado", "PRODUCT_NOT_FOUND", 404);
  }
  if (product.type !== "VARIANTE") {
    throw createError(
      "Solo un producto de tipo VARIANTE admite variantes",
      "PRODUCT_NOT_VARIANTE_TYPE",
      400
    );
  }

  return product;
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
    const product = await ensureProductIsVariante(tenantId, productId);

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
    await ensureProductIsVariante(tenantId, productId);
    const existing = await this.getByIdForManagement({ tenantId, productId, variantId });

    // Desactivar la última variante activa de un producto VARIANTE lo dejaría
    // invendible — misma guarda que en `deleteVariant`.
    if (isActive === false && existing.isActive) {
      await ensureNotLastActiveVariant({ tenantId, productId, variantId });
    }

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
    await ensureProductIsVariante(tenantId, productId);
    await this.getByIdForManagement({ tenantId, productId, variantId });
    await ensureNotLastActiveVariant({ tenantId, productId, variantId });

    return prisma.productVariant.delete({ where: { id: variantId } });
  },
};

// Bloquea borrar/desactivar la última variante ACTIVA de un producto VARIANTE: lo
// dejaría sin forma de venderse (a diferencia de UNIDAD/COMBO, un VARIANTE no tiene
// stock/precio propio como respaldo). Gap detectado durante el rediseño de tipos.
async function ensureNotLastActiveVariant({ tenantId, productId, variantId }) {
  const activeCount = await prisma.productVariant.count({
    where: { tenantId, productId, isActive: true },
  });

  const targetIsTheOnlyActiveOne = activeCount === 1;
  if (!targetIsTheOnlyActiveOne) return;

  const target = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: { isActive: true },
  });

  if (target?.isActive) {
    throw createError(
      "No se puede borrar/desactivar la última variante activa de un producto VARIANTE",
      "CANNOT_DELETE_LAST_VARIANT",
      409
    );
  }
}
