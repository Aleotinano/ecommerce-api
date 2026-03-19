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

  async createVariant({
    productId,
    color,
    size,
    price,
    stock,
    sku,
    img,
    isActive,
  }) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      throw createError("Producto no encontrado", "PRODUCT_NOT_FOUND", 404);
    }

    const existing = await prisma.productVariant.findFirst({
      where: { productId, sku },
    });

    if (existing) {
      throw createError(
        "Ya existe una variante con ese SKU",
        "SKU_DUPLICATE",
        409
      );
    }

    return prisma.productVariant.create({
      data: {
        productId,
        color: color ?? null,
        size: size ?? null,
        price,
        stock,
        sku,
        img: img ?? null,
        isActive: isActive ?? true,
      },
    });
  },

  async editVariant(
    { productId, variantId },
    { color, size, price, stock, sku, img, isActive }
  ) {
    const variant = await prisma.productVariant.findFirst({
      where: { id: variantId, productId },
    });

    if (!variant) {
      throw createError("Variante no encontrada", "VARIANT_NOT_FOUND", 404);
    }

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

    const data = { color, size, price, stock, sku, img, isActive };
    const updateData = Object.fromEntries(
      Object.entries(data).filter(([_, v]) => v !== undefined)
    );

    return prisma.productVariant.update({
      where: { id: variantId },
      data: updateData,
    });
  },

  async deleteVariant({ productId, variantId }) {
    const variant = await prisma.productVariant.findFirst({
      where: { id: variantId, productId },
    });

    if (!variant) {
      throw createError("Variante no encontrada", "VARIANT_NOT_FOUND", 404);
    }

    return prisma.productVariant.delete({
      where: { id: variantId },
    });
  },
};
