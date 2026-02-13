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

  static async get(req, res) {
    try {
      const { id } = req.params;
      const { id: userId } = req.user;

      const payment = await mercadopagoModel.get({ id, userId });

      if (!payment) {
        return res.status(404).json({
          success: false,
          message: "No se encontró la orden",
        });
      }

      return res.json({
        success: true,
        orden: {
          id: payment.id,
          status: payment.status,
          paymentStatus: payment.paymentStatus,
          total: payment.total,
          mercadoPagoId: payment.mercadoPagoId,
          preferenceId: payment.preferenceId,
          createdAt: payment.createdAt,
        },
      });
    } catch (error) {
      console.error("❌ Error obteniendo orden:", error);
      return res.status(500).json({
        success: false,
        message: "Error al obtener la orden",
      });
    }
  }
}
