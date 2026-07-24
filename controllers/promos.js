import { PromoModel } from "../services/promos.js";

export class PromoController {
  static async getAll(req, res, next) {
    try {
      const { isActive, productId, limit, offset } = req.search;
      const promos = await PromoModel.getAll({
        tenantId: req.tenantId,
        isActive,
        productId,
        limit,
        offset,
      });
      return res.json(promos);
    } catch (error) {
      next(error);
    }
  }

  static async getById(req, res, next) {
    try {
      const { id } = req.params;
      const promo = await PromoModel.getById({ tenantId: req.tenantId, id });
      return res.json(promo);
    } catch (error) {
      next(error);
    }
  }

  static async create(req, res, next) {
    try {
      const promo = await PromoModel.create({ tenantId: req.tenantId, ...req.body });
      return res.status(201).json({ message: "Promoción creada", promo });
    } catch (error) {
      next(error);
    }
  }

  static async edit(req, res, next) {
    try {
      const { id } = req.params;
      const promo = await PromoModel.edit({ tenantId: req.tenantId, id, ...req.body });
      return res.json({ message: "Promoción actualizada", promo });
    } catch (error) {
      next(error);
    }
  }

  static async delete(req, res, next) {
    try {
      const { id } = req.params;
      await PromoModel.delete({ tenantId: req.tenantId, id });
      return res.json({ message: "Promoción eliminada" });
    } catch (error) {
      next(error);
    }
  }
}
