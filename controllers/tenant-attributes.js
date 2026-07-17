import { TenantAttributeModel } from "../services/tenant-attributes.js";

export class TenantAttributeController {
  static async get(req, res, next) {
    try {
      const { tenantId } = req.params;

      const attributes = await TenantAttributeModel.get({
        tenantId: parseInt(tenantId),
      });

      res.json({ attributes });
    } catch (error) {
      next(error);
    }
  }

  static async setup(req, res, next) {
    try {
      const { tenantId } = req.params;
      const { attributes } = req.body;

      const created = await TenantAttributeModel.setup({
        tenantId: parseInt(tenantId),
        attributes,
      });

      res.status(201).json({
        message: "Atributos definidos",
        attributes: created,
      });
    } catch (error) {
      next(error);
    }
  }
}
