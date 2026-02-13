import prisma from "../lib/prisma.js";
import { preference, payment } from "../config/mercadoPago.js";
import {
  createError,
  getBackUrls,
  getPaymentMethods,
} from "../helpers/mercadopago.js";

export const mercadopagoModel = {
  async create({ userId, orderId, payerEmail }) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, userId },
      include: {
        user: { select: { email: true } },
        orderItems: { include: { product: true } },
      },
    });

    if (!order) throw createError("Orden no encontrada", "ORDER_NOT_FOUND");
    if (order.status === "CANCELLED")
      throw createError(
        "No se puede pagar una orden cancelada",
        "ORDER_CANCELLED"
      );
    if (order.paymentStatus === "APPROVED")
      throw createError("La orden ya fue pagada", "ORDER_ALREADY_PAID");

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
      notification_url: `${process.env.BASE_URL}/mercadopago/webhook`,
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
      throw createError(
        "Error processing payment",
        "PAYMENT_PROCESSING_ERROR",
        console.log(error)
      );
    }
  },

  async processWebhook({ paymentId }) {
    const paymentInfo = await payment.get({
      id: paymentId,
    });

    if (paymentInfo.status !== "approved") {
      console.log("Pago no aprobado todavía");
      return;
    }

    const orderId = Number(paymentInfo.external_reference);

    if (!orderId) {
      throw new Error("External reference inválida");
    }

    // 4️⃣ Buscar orden
    const order = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new Error("Orden no encontrada");
    }

    // 5️⃣ Idempotencia
    if (order.status === "COMPLETED") {
      throw new Error("Orden ya pagada");
    }

    // 6️⃣ Validación de monto
    if (order.total !== paymentInfo.transaction_amount) {
      throw new Error("Monto inválido");
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
