import prisma from "../../lib/prisma.js";

export const Data = async ({ tenantId, currentStart, now, previousStart }) => {
  const [
    currentOrders,
    previousOrders,
    allProducts,
    currentPayments,
    previousPayments,
    config,
  ] = await Promise.all([
    prisma.order.findMany({
      where: {
        tenantId,
        createdAt: {
          gte: currentStart,
          lte: now,
        },
      },
      orderBy: { createdAt: "asc" },
      include: {
        orderItems: {
          include: {
            product: {
              include: {
                category: {
                  select: { id: true, name: true },
                },
                variants: {
                  select: {
                    id: true,
                    stock: true,
                    isActive: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.order.findMany({
      where: {
        tenantId,
        createdAt: {
          gte: previousStart,
          lt: currentStart,
        },
      },
      include: {
        orderItems: {
          select: {
            quantity: true,
          },
        },
      },
    }),
    prisma.product.findMany({
      where: { tenantId },
      include: {
        category: {
          select: {
            id: true,
            name: true,
          },
        },
        variants: {
          select: {
            id: true,
            stock: true,
            isActive: true,
          },
        },
      },
      orderBy: { id: "asc" },
    }),

    // Libro de cobros del período. Por `confirmedAt` (cuándo entró la plata) y no
    // por la fecha de la orden: una orden de marzo cobrada en abril es plata de
    // abril, que es justamente la brecha que este panel muestra.
    prisma.orderPayment.findMany({
      where: { tenantId, confirmedAt: { gte: currentStart, lte: now } },
      select: { kind: true, channel: true, amount: true },
    }),
    prisma.orderPayment.findMany({
      where: { tenantId, confirmedAt: { gte: previousStart, lt: currentStart } },
      select: { kind: true, channel: true, amount: true },
    }),

    prisma.tenantConfig.findUnique({
      where: { tenantId },
      select: { cashRegisterEnabled: true },
    }),
  ]);

  // La caja solo se consulta si el tenant la tiene: para el resto no existe y no
  // vale un round-trip.
  const cashSessions = config?.cashRegisterEnabled
    ? await prisma.cashRegisterSession.findMany({
        // Un turno se toma ENTERO y cuenta en el día en que se abrió (ver
        // `buildCashPanel`): un turno noche que cierra a las 2 AM no se parte, y sus
        // movimientos de la madrugada entran igual.
        where: { tenantId, openedAt: { gte: currentStart, lte: now } },
        orderBy: { openedAt: "asc" },
        include: {
          movements: { include: { category: { select: { key: true, label: true } } } },
        },
      })
    : null;

  return {
    currentOrders,
    previousOrders,
    allProducts,
    currentPayments,
    previousPayments,
    cashSessions,
    cashRegisterEnabled: Boolean(config?.cashRegisterEnabled),
  };
};
