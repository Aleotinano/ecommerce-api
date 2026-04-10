import { mercadopagoModel } from "../services/mercadopago.js";
import { validateWebhookSignature } from "../helpers/mercadopago.js";

export class mercadopagoController {
  static async create(req, res, next) {
    try {
      const { id: userId, email: payerEmail } = req.user;
      const { id: orderId } = req.params;

      const mpOrder = await mercadopagoModel.create({
        userId,
        orderId,
        payerEmail,
      });

      return res.status(201).json({
        message: "Link de pago creado",
        init_point: mpOrder.init_point,
      });
    } catch (error) {
      next(error);
    }
  }
  static async getWebhook(req, res, next) {
    try {
      const paymentId = req.body?.data?.id;
      const eventType = req.body?.type;

      if (!paymentId) return res.sendStatus(204);
      if (eventType !== "payment") return res.sendStatus(200);

      const webhookSecret = process.env.MP_WEBHOOK_SECRET;

      if (!webhookSecret) {
        console.error("[MP][webhook] MP_WEBHOOK_SECRET no configurado");
        return res.sendStatus(500);
      }

      const isValid = validateWebhookSignature({
        signature: req.headers["x-signature"],
        requestId: req.headers["x-request-id"],
        dataId: paymentId,
        secret: webhookSecret,
      });

      if (!isValid) {
        console.warn("[MP][webhook] Firma inválida");
        return res.sendStatus(401);
      }

      const orderStatus = await mercadopagoModel.getWebhook({ paymentId });
      return res.json({ orderStatus });
    } catch (error) {
      next(error);
    }
  }
}
