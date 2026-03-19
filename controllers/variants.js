// ─── AGREGAR esta clase en controllers/productos.js ───

export class variantsController {
  static async getAll(req, res, next) {
    try {
      const { productId } = req.params;
      const variants = await ProductModel.getVariants({
        productId: Number(productId),
      });
      return res.json({ variants });
    } catch (error) {
      next(error);
    }
  }

  static async create(req, res, next) {
    try {
      const { productId } = req.params;
      const { color, size, price, stock, sku, img, isActive } = req.body;

      const variant = await ProductModel.createVariant({
        productId: Number(productId),
        color,
        size,
        price,
        stock,
        sku,
        img,
        isActive,
      });

      return res.status(201).json({ message: "Variante creada", variant });
    } catch (error) {
      next(error);
    }
  }

  static async edit(req, res, next) {
    try {
      const { productId, id: variantId } = req.params;
      const { color, size, price, stock, sku, img, isActive } = req.body;

      const variant = await ProductModel.editVariant(
        { productId: Number(productId), variantId: Number(variantId) },
        { color, size, price, stock, sku, img, isActive }
      );

      return res.json({ message: "Variante actualizada", variant });
    } catch (error) {
      next(error);
    }
  }

  static async delete(req, res, next) {
    try {
      const { productId, id: variantId } = req.params;

      await ProductModel.deleteVariant({
        productId: Number(productId),
        variantId: Number(variantId),
      });

      return res.json({ message: "Variante eliminada" });
    } catch (error) {
      next(error);
    }
  }
}
