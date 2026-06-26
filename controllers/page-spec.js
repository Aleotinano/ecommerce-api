import { PageSpecModel } from "../services/page-spec.js";

/**
 * API admin del Page Builder. El `tenantId` viene del JWT (`req.tenantId`), nunca del
 * cliente. Editar el draft no publica; publicar es una acción humana explícita.
 */
export class PageSpecController {
  static async getDraft(req, res, next) {
    try {
      const draft = await PageSpecModel.getDraft({ tenantId: req.tenantId });
      return res.json({
        spec: draft?.spec ?? null,
        version: draft?.version ?? 0,
        updatedAt: draft?.updatedAt ?? null,
      });
    } catch (error) {
      next(error);
    }
  }

  static async saveDraft(req, res, next) {
    try {
      const result = await PageSpecModel.saveDraft({
        tenantId: req.tenantId,
        spec: req.body.spec,
      });
      return res.json({ message: "Borrador guardado", ...result });
    } catch (error) {
      next(error);
    }
  }

  static async publish(req, res, next) {
    try {
      const result = await PageSpecModel.publish({ tenantId: req.tenantId });
      return res.json({ message: "Página publicada", ...result });
    } catch (error) {
      next(error);
    }
  }
}
