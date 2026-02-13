import { mercadopagoModel } from "../services/mercadopago.js";

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
        init_point: mpOrder.sandbox_init_point,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getWebhook(req, res, next) {
    try {
      const paymentId = req.body?.data?.id;
      const eventType = req.body?.type;

      if (!paymentId) {
        return res.sendStatus(204);
      }

      // Solo procesar eventos de payment
      if (eventType !== "payment") {
        return res.sendStatus(200);
      }

      const orderStatus = await mercadopagoModel.getWebhook({ paymentId });

      return res.json({ orderStatus });
    } catch (error) {
      next(error);
    }
  }
}
