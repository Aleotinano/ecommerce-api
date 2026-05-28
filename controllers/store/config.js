import { TenantConfigModel } from "../../services/tenant-config.js";

export class StoreConfigController {
  static async get(req, res, next) {
    try {
      const config = await TenantConfigModel.get({
        tenantId: req.tenantId,
      });
      return res.json(config);
    } catch (error) {
      next(error);
    }
  }
}
