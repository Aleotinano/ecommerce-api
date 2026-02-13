import { mercadopagoModel } from "../services/mercadopago.js";

export class mercadopagoController {
  static async create(req, res) {
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
      switch (error.code) {
        case "ORDER_NOT_FOUND":
          return res.status(404).json({ message: "Orden no encontrada" });
        case "ORDER_CANCELLED":
          return res
            .status(400)
            .json({ message: "La orden est\u00e1 cancelada" });
        case "ORDER_ALREADY_PAID":
          return res.status(400).json({ message: "La orden ya fue pagada" });
        case "PAYER_EMAIL_REQUIRED":
          return res
            .status(400)
            .json({ message: "Email del pagador requerido" });
        default:
          console.error("Error al crear orden de pago:", error);
          return res
            .status(500)
            .json({ message: "Error al crear orden de pago" });
      }
    }
  }

  static async getWebhook(req, res) {
    try {
      const paymentId = req.body?.data?.id;

      if (!paymentId) return res.sendStatus(204);

      const orderStatus = await mercadopagoModel.processWebhook({ paymentId });

      return res.json({ orderStatus: orderStatus });
    } catch (error) {
      console.error("Error webhook:", error);
      return res.sendStatus(500);
    }
  }
}
