import { Data } from "./stats/queries.js";
import {
  buildDailySeries,
  buildOrderStatusPanel,
  buildProductRanking,
  buildRevenueByCategory,
} from "./stats/builders.js";
import {
  isCompletedOrder,
  sumCompletedRevenue,
  sumCompletedUnits,
} from "./stats/order-helpers.js";
import { addDays, buildMetric, round, startOfDay } from "./stats/utils.js";

export const StatsModel = {
  async getDashboard({ tenantId, days = 30, lowStockThreshold = 5 }) {
    const now = new Date();
    const currentStart = startOfDay(addDays(now, -(days - 1)));
    const previousStart = addDays(currentStart, -days);

    const data = await Data({
      tenantId,
      currentStart,
      now,
      previousStart,
    });

    const currentRevenue = round(sumCompletedRevenue(data.currentOrders));
    const previousRevenue = round(sumCompletedRevenue(data.previousOrders));
    const currentCompletedOrders =
      data.currentOrders.filter(isCompletedOrder).length;
    const previousCompletedOrders =
      data.previousOrders.filter(isCompletedOrder).length;
    const currentUnitsSold = sumCompletedUnits(data.currentOrders);
    const previousUnitsSold = sumCompletedUnits(data.previousOrders);
    const currentUniqueCustomers = new Set(
      data.currentOrders.map((order) => order.userId)
    );
    const previousPeriodCustomers = new Set(
      data.previousOrders.map((order) => order.userId)
    );
    const averageOrderValueCurrent =
      currentCompletedOrders > 0 ? currentRevenue / currentCompletedOrders : 0;
    const averageOrderValuePrevious =
      previousCompletedOrders > 0
        ? previousRevenue / previousCompletedOrders
        : 0;

    return {
      generatedAt: now,
      filters: {
        days,
        lowStockThreshold,
        currentPeriod: {
          from: currentStart,
          to: now,
        },
        previousPeriod: {
          from: previousStart,
          to: currentStart,
        },
      },
      kpis: {
        revenue: buildMetric({
          current: currentRevenue,
          previous: previousRevenue,
        }),
        completedOrders: buildMetric({
          current: currentCompletedOrders,
          previous: previousCompletedOrders,
        }),
        averageOrderValue: buildMetric({
          current: averageOrderValueCurrent,
          previous: averageOrderValuePrevious,
        }),
        unitsSold: buildMetric({
          current: currentUnitsSold,
          previous: previousUnitsSold,
        }),
        activeCustomers: buildMetric({
          current: currentUniqueCustomers.size,
          previous: previousPeriodCustomers.size,
        }),
      },
      charts: {
        dailyTrend: {
          metric: "revenue",
          granularity: "day",
          series: buildDailySeries({
            currentStart,
            days,
            orders: data.currentOrders,
          }),
        },
        orderStatus: buildOrderStatusPanel(data.currentOrders),
        revenueByCategory: buildRevenueByCategory(data.currentOrders),
      },
      ranking: {
        products: buildProductRanking({
          orders: data.currentOrders,
          allProducts: data.allProducts,
          lowStockThreshold,
        }),
      },
      meta: {
        criteria: {
          revenueBasedOn: "COMPLETED_ORDERS",
          rankingSize: 5,
          lowStockThreshold,
        },
      },
    };
  },
};
