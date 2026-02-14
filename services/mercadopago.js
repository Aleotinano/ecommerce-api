import prisma from "../lib/prisma.js";
import { preference, payment } from "../config/mercadoPago.js";
import { getBackUrls, getPaymentMethods } from "../helpers/mercadopago.js";
import { createError } from "../helpers/error.js";
import { DEFAULTS } from "../config.js";

export const mercadopagoModel = {
  async create({ userId, orderId, payerEmail }) {
    if (!payerEmail) {
      throw createError("Email requerido", "PAYER_EMAIL_REQUIRED", 400);
    }

    const order = await prisma.order.findFirst({
      where: { id: orderId, userId },
      include: {
        user: { select: { email: true } },
        orderItems: { include: { product: true } },
      },
    });

    if (!order)
      throw createError("Orden no encontrada", "ORDER_NOT_FOUND", 404);
    if (order.status === "CANCELLED")
      throw createError(
        "No se puede pagar una orden cancelada",
        "ORDER_CANCELLED",
        409
      );
    if (order.paymentStatus === "APPROVED")
      throw createError("La orden ya fue pagada", "ORDER_ALREADY_PAID", 409);

    // Convertimos los items de la orden al formato esperado por Mercado Pago.
    const items = order.orderItems.map((item) => ({
      title: item.product.name,
      description: item.product.description,
      quantity: item.quantity,
      unit_price: Number(item.product.price.toFixed(2)),
      currency_id: "ARS",
    }));

    const bodyMp = {
      items,
      payer: { email: payerEmail },
      auto_return: "approved",
      back_urls: getBackUrls(),
      payment_methods: getPaymentMethods(),
      external_reference: Number(order.id),
      notification_url: `${DEFAULTS.BASE_URL}/mercadopago/webhook`,
    };

    try {
      const mpResponse = await preference.create({
        body: bodyMp,
      });

      // Guardamos el id de MP y dejamos la orden en proceso.
      await prisma.order.update({
        where: { id: order.id },
        data: {
          mercadoPagoId: mpResponse?.id ? String(mpResponse.id) : null,
          preferenceId: mpResponse?.id ? String(mpResponse.id) : null,
          paymentStatus: "IN_PROCESS",
        },
      });

      return mpResponse;
    } catch (error) {
      console.log(error);
      throw createError(
        "Error processing payment",
        "PAYMENT_PROCESSING_ERROR",
        502
      );
    }
  },

  async getWebhook({ paymentId }) {
    const paymentInfo = await payment.get({
      id: paymentId,
    });

    if (paymentInfo.status !== "approved") {
      console.log("Pago no aprobado todavía");
      return;
    }

    const orderId = Number(paymentInfo.external_reference);

    if (!orderId) {
      throw createError(
        "External reference inválida",
        "INVALID_EXTERNAL_REFERENCE",
        400
      );
    }

    // 4️⃣ Buscar orden
    const order = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw createError("Orden no encontrada", "ORDER_NOT_FOUND", 404);
    }

    // 5️⃣ Idempotencia
    if (order.status === "COMPLETED") {
      throw createError("Orden ya pagada", "ORDER_ALREADY_PAID", 409);
    }

    // 6️⃣ Validación de monto
    if (order.total !== paymentInfo.transaction_amount) {
      throw createError("Monto inválido", "AMOUNT_MISMATCH", 409);
    }

    // 7️⃣ Actualizar orden
    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: "COMPLETED",
        paymentStatus: "APPROVED",
        paymentId: String(paymentInfo.id),
      },
    });

    return order.status;
  },
};
