import prisma from "../../lib/prisma.js";

export const Data = async ({ tenantId, currentStart, now, previousStart }) => {
  const [currentOrders, previousOrders, allProducts] = await Promise.all([
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
  ]);

  return {
    currentOrders,
    previousOrders,
    allProducts,
  };
};
