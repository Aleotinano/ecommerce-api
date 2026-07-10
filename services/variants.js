import prisma from "../lib/prisma.js";
import { createError } from "../helpers/error.js";
import { generateUniqueVariantSku } from "../utils/sku.js";

const ensureProductIsNotCombo = async (tenantId, productId) => {
  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId },
    select: { id: true, name: true, type: true },
  });

  if (!product) {
    throw createError("Producto no encontrado", "PRODUCT_NOT_FOUND", 404);
  }
  if (product.type === "COMBO") {
    throw createError(
      "Un combo no admite variantes",
      "PRODUCT_IS_COMBO",
      400
    );
  }

  return product;
};

// Si el borrado/desactivación de una variante se lleva puesta la principal
// (`isDefault`), promueve la de menor id entre las que queden ACTIVAS — así una
// línea sin variantId explícito (ver `resolveVariantForProduct`) siempre resuelve a
// algo vendible. No-op si no queda ninguna activa (el producto entra en el mismo
// estado transitorio "sin variante disponible" que uno recién creado).
const promoteNewDefault = async (tx, { tenantId, productId }) => {
  const candidate = await tx.productVariant.findFirst({
    where: { tenantId, productId, isActive: true },
    orderBy: { id: "asc" },
  });

  if (candidate) {
    await tx.productVariant.update({
      where: { id: candidate.id },
      data: { isDefault: true },
    });
  }
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
    const product = await ensureProductIsNotCombo(tenantId, productId);

    const sku = await generateUniqueVariantSku({
      prisma,
      tenantId,
      productName: product.name,
    });

    // La primera variante de un producto (alta en 2 pasos: producto "vacío" ->
    // agregar variante principal) es automáticamente la default — no depende de
    // que el caller lo pida.
    const existingCount = await prisma.productVariant.count({
      where: { tenantId, productId },
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
        isDefault: existingCount === 0,
      },
    });
  },

  async editVariant(
    { tenantId, productId, variantId },
    { color, size, price, stock, img, imgPublicId, isActive }
  ) {
    await ensureProductIsNotCombo(tenantId, productId);
    const existing = await this.getByIdForManagement({ tenantId, productId, variantId });

    // Desactivar la última variante activa de un producto lo dejaría invendible —
    // misma guarda que en `deleteVariant`.
    if (isActive === false && existing.isActive) {
      await ensureNotLastActiveVariant({ tenantId, productId, variantId });
    }

    const deactivatingDefault = isActive === false && existing.isActive && existing.isDefault;

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
    // Una variante inactiva no puede seguir siendo la default (dejaría de ser
    // resoluble por `resolveVariantForProduct` para un add-to-cart sin elección).
    if (deactivatingDefault) {
      updateData.isDefault = false;
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.productVariant.update({
        where: { id: variantId },
        data: updateData,
      });

      if (deactivatingDefault) {
        await promoteNewDefault(tx, { tenantId, productId });
      }

      return updated;
    });
  },

  async deleteVariant({ tenantId, productId, variantId }) {
    await ensureProductIsNotCombo(tenantId, productId);
    const existing = await this.getByIdForManagement({ tenantId, productId, variantId });
    await ensureNotLastActiveVariant({ tenantId, productId, variantId });

    return prisma.$transaction(async (tx) => {
      const deleted = await tx.productVariant.delete({ where: { id: variantId } });

      if (existing.isDefault) {
        await promoteNewDefault(tx, { tenantId, productId });
      }

      return deleted;
    });
  },
};

// Bloquea borrar/desactivar la última variante ACTIVA de un producto: lo dejaría
// sin forma de venderse (todo PRODUCTO depende de su(s) variante(s) para precio y
// stock, no tiene columnas propias de respaldo).
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
      "No se puede borrar/desactivar la última variante activa del producto",
      "CANNOT_DELETE_LAST_VARIANT",
      409
    );
  }
}
