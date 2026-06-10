import prisma from "../../lib/prisma.js";

/**
 * Trae los datos necesarios para elegir el producto a destacar:
 * - completedOrders: ventas cerradas (COMPLETED) dentro de la ventana, con la
 *   cadena orderItems -> variant -> product para sumar unidades por producto.
 * - products: catalogo del tenant con createdAt y stock de variantes activas.
 * - lastSuggestion: ultima sugerencia del tenant (para rotar el angulo).
 */
export const loadSelectionData = async ({ tenantId, windowStart, now }) => {
  const [completedOrders, products, lastSuggestion] = await Promise.all([
    prisma.order.findMany({
      where: {
        tenantId,
        status: "COMPLETED",
        createdAt: { gte: windowStart, lte: now },
      },
      select: {
        orderItems: {
          select: {
            quantity: true,
            variant: { select: { productId: true } },
          },
        },
      },
    }),
    prisma.product.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        isActive: true,
        createdAt: true,
        variants: {
          select: { stock: true, isActive: true },
        },
      },
      orderBy: { id: "asc" },
    }),
    prisma.contentSuggestion.findFirst({
      where: { tenantId },
      orderBy: { date: "desc" },
      select: { angle: true },
    }),
  ]);

  return { completedOrders, products, lastSuggestion };
};
