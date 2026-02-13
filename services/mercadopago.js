import prisma from "../lib/prisma.js";
import { preference } from "../config/mercadoPago.js";
import {
  createError,
  getBackUrls,
  getPaymentMethods,
} from "../helpers/mercadopago.js";

export const mercadopagoModel = {
  async create({ userId, orderId, payerEmail }) {
    const cartOrder = await prisma.order.findFirst({
      where: { id: orderId, userId },
      include: {
        user: { select: { email: true } },
        orderItems: { include: { product: true } },
      },
    });

    if (!cartOrder) throw createError("Orden no encontrada", "ORDER_NOT_FOUND");
    if (cartOrder.status === "CANCELLED")
      throw createError(
        "No se puede pagar una orden cancelada",
        "ORDER_CANCELLED"
      );
    if (cartOrder.paymentStatus === "APPROVED")
      throw createError("La orden ya fue pagada", "ORDER_ALREADY_PAID");

    // Convertimos los items de la orden al formato esperado por Mercado Pago.
    const items = cartOrder.orderItems.map((item) => ({
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
      external_reference: String(cartOrder.id),
    };

    console.log("MP body:", JSON.stringify(bodyMp, null, 2));

    try {
      const mpResponse = await preference.create({
        body: bodyMp,
      });

      // Guardamos el id de MP y dejamos la orden en proceso.
      await prisma.order.update({
        where: { id: cartOrder.id },
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

  async get({ id, userId }) {
    const order = await prisma.order.findFirst({
      where: {
        id: id,
        userId: userId,
      },
      include: {
        orderItems: {
          include: {
            product: true,
          },
        },
      },
    });

    return order;
  },
};
