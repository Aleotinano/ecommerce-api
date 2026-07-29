import prisma from "../lib/prisma.js";
import { preference, payment } from "../config/mercadopago.js";
import { getBackUrls, getPaymentMethods } from "../helpers/mercadopago.js";
import { createError } from "../helpers/error.js";
import { DEFAULTS } from "../config.js";
import { logger } from "../lib/logger.js";
import { OrderModel } from "./orders.js";

const log = logger.child({ module: "mercadopago" });

// `attributeValues` son los valores de `variant.attributes` en el orden del catálogo
// del tenant (la escritura los normaliza por `position`, ver TenantAttributeModel).
const buildMpItemTitle = ({ productName, attributeValues = [] }) => {
  const descriptors = [productName, ...attributeValues].filter(Boolean);
  return descriptors.join(" - ") || "Variante";
};

export const mercadopagoModel = {
  async create({ tenantId, userId, orderId, payerEmail }) {
    if (!payerEmail) {
      throw createError("Email requerido", "PAYER_EMAIL_REQUIRED", 400);
    }

    const order = await prisma.order.findFirst({
      where: { id: orderId, userId, tenantId },
      include: {
        user: { select: { email: true } },
        orderItems: {
          include: {
            variant: {
              include: {
                product: true,
              },
            },
          },
        },
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

    const items = order.orderItems.map((item) => {
      const variant = item.variant;
      const productName = variant.product?.name ?? variant.sku;

      return {
        title: buildMpItemTitle({
          productName,
          attributeValues: Object.values(variant.attributes ?? {}),
        }),
        description: variant.product?.description ?? productName,
        quantity: item.quantity,
        unit_price: Number(item.price.toFixed(2)),
        currency_id: "ARS",
        sku: variant.sku,
        picture_url: variant.img ?? variant.product?.img ?? undefined,
      };
    });

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
      console.log("Pago no aprobado todav�a");
      return;
    }

    const orderId = Number(paymentInfo.external_reference);

    if (!orderId) {
      throw createError(
        "External reference inv�lida",
        "INVALID_EXTERNAL_REFERENCE",
        400
      );
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw createError("Orden no encontrada", "ORDER_NOT_FOUND", 404);
    }

    if (order.status === "COMPLETED") {
      throw createError("Orden ya pagada", "ORDER_ALREADY_PAID", 409);
    }

    if (Number(order.total) !== Number(paymentInfo.transaction_amount)) {
      throw createError("Monto inv�lido", "AMOUNT_MISMATCH", 409);
    }

    // El cobro se registra SIEMPRE, pase lo que pase con el estado: la plata
    // entró y eso es un hecho, independiente de si la orden está en condiciones
    // de producirse.
    await OrderModel.registerPayment({
      tenantId: order.tenantId,
      orderId,
      kind: "PAYMENT",
      channel: "GATEWAY",
      amount: Number(paymentInfo.transaction_amount),
      note: `MercadoPago ${paymentInfo.id}`,
    });

    await prisma.order.update({
      where: { id: orderId },
      data: { paymentId: String(paymentInfo.id) },
    });

    // Completar es lo que se intenta, no lo que se garantiza. Antes esto era un
    // `updateOrderStatus` pelado: si la orden venía del storefront y nadie la
    // había revisado, lanzaba ORDER_NOT_REVIEWED, el error salía como 500 y
    // MercadoPago reintentaba el webhook para siempre — con el cobro sin
    // registrar. Ahora el cobro ya quedó anotado y el estado avanza si puede.
    try {
      await OrderModel.updateOrderStatus({
        tenantId: order.tenantId,
        orderId,
        status: "COMPLETED",
        trigger: "GATEWAY",
        note: "Pago aprobado por MercadoPago",
      });

      return "COMPLETED";
    } catch (error) {
      log.warn(
        { err: error, orderId, code: error.code },
        "pago registrado, pero la orden no está en condiciones de completarse"
      );

      return "PAID";
    }
  },
};
