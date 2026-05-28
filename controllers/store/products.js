import { ProductModel } from "../../services/productos.js";

export class StoreProductsController {
  static async getAll(req, res, next) {
    try {
      const {
        name,
        categoryId,
        variantColor,
        variantSize,
        minPrice,
        maxPrice,
        limit,
        offset,
      } = req.search;

      const pagination = await ProductModel.getAll({
        tenantId: req.tenantId,
        name,
        categoryId,
        variantColor,
        variantSize,
        minPrice,
        maxPrice,
        limit,
        offset,
        includeInactive: false,
      });

      return res.json(pagination);
    } catch (error) {
      next(error);
    }
  }

  static async getVariantOptions(req, res, next) {
    try {
      const options = await ProductModel.getVariantOptions({
        tenantId: req.tenantId,
      });
      return res.json(options);
    } catch (error) {
      next(error);
    }
  }

  static async getById(req, res, next) {
    try {
      const { id } = req.params;
      const product = await ProductModel.getById({
        tenantId: req.tenantId,
        id,
      });
      return res.json(product);
    } catch (error) {
      next(error);
    }
  }
}
