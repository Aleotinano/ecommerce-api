import { mercadopagoModel } from "../services/mercadopago.js";
import { validateWebhookSignature } from "../helpers/mercadopago.js";
import { DEFAULTS } from "../config.js";
import { logger } from "../lib/logger.js";

export class mercadopagoController {
  static async create(req, res, next) {
    try {
      const { id: userId, email: payerEmail } = req.user;
      const { id: orderId } = req.params;

      const mpOrder = await mercadopagoModel.create({
        tenantId: req.tenantId,
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

      const webhookSecret = DEFAULTS.MP_WEBHOOK_SECRET;

      // Sin secreto NO se procesa: se corta antes de verificar. Es lo que impide
      // que un POST inventado contra la URL pública marque una orden como pagada.
      // El 500 hace que MercadoPago reintente, que es lo correcto — el aviso no se
      // pierde y llega cuando el secreto esté puesto.
      if (!webhookSecret) {
        logger.error(
          { module: "mercadopago:webhook", paymentId },
          "MP_WEBHOOK_SECRET no configurado: el webhook se rechaza sin procesar"
        );
        return res.sendStatus(500);
      }

      const isValid = validateWebhookSignature({
        signature: req.headers["x-signature"],
        requestId: req.headers["x-request-id"],
        dataId: paymentId,
        secret: webhookSecret,
      });

      if (!isValid) {
        logger.warn(
          { module: "mercadopago:webhook", paymentId },
          "firma de webhook invalida"
        );
        return res.sendStatus(401);
      }

      const orderStatus = await mercadopagoModel.getWebhook({ paymentId });
      return res.json({ orderStatus });
    } catch (error) {
      next(error);
    }
  }
}
