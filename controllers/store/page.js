import { PageSpecModel } from "../../services/page-spec.js";

export class StorePageController {
  /** Spec publicado del tenant (resuelto por slug). Shape estable aunque no haya spec. */
  static async get(req, res, next) {
    try {
      const published = await PageSpecModel.getPublished({
        tenantId: req.tenantId,
      });
      return res.json({
        spec: published?.spec ?? null,
        version: published?.version ?? 0,
        publishedAt: published?.publishedAt ?? null,
      });
    } catch (error) {
      next(error);
    }
  }
}
