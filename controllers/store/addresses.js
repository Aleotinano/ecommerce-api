import { AddressModel } from "../../services/addresses.js";

export class StoreAddressesController {
  static async getAll(req, res, next) {
    try {
      const addresses = await AddressModel.getAll({
        tenantId: req.tenantId,
        userId: req.user.id,
      });
      res.json({ addresses });
    } catch (error) {
      next(error);
    }
  }

  static async getById(req, res, next) {
    try {
      const { id } = req.params;
      const address = await AddressModel.getById({
        tenantId: req.tenantId,
        userId: req.user.id,
        id,
      });
      res.json({ address });
    } catch (error) {
      next(error);
    }
  }

  static async create(req, res, next) {
    try {
      const address = await AddressModel.create({
        tenantId: req.tenantId,
        userId: req.user.id,
        ...req.body,
      });
      res.status(201).json({ message: "Dirección creada", address });
    } catch (error) {
      next(error);
    }
  }

  static async edit(req, res, next) {
    try {
      const { id } = req.params;
      const address = await AddressModel.edit({
        tenantId: req.tenantId,
        userId: req.user.id,
        id,
        ...req.body,
      });
      res.json({ message: "Dirección actualizada", address });
    } catch (error) {
      next(error);
    }
  }

  static async delete(req, res, next) {
    try {
      const { id } = req.params;
      const address = await AddressModel.delete({
        tenantId: req.tenantId,
        userId: req.user.id,
        id,
      });
      res.json({ message: "Dirección eliminada", address });
    } catch (error) {
      next(error);
    }
  }
}
