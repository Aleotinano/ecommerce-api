import { Data } from "./stats/queries.js";
import {
  buildDailySeries,
  buildOrderStatusPanel,
  buildProductRanking,
  buildRevenueByCategory,
} from "./stats/builders.js";
import { buildCashPanel, buildCollectionsPanel } from "./stats/money.js";
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

    // Facturado (arriba) vs cobrado: hasta acá el dashboard solo sabía de
    // facturación. Ver services/stats/money.js.
    const cobranzas = buildCollectionsPanel({
      facturado: currentRevenue,
      payments: data.currentPayments,
      previousPayments: data.previousPayments,
    });

    // `null` —y no un panel en cero— cuando el tenant no tiene caja: cero egresos
    // por no llevar caja no es lo mismo que cero egresos.
    const caja = data.cashRegisterEnabled
      ? buildCashPanel({ sessions: data.cashSessions ?? [], cobrado: cobranzas.cobrado })
      : null;

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
        // Plata que entró de verdad en el período, neta de devoluciones. Junto a
        // `revenue` (facturado) es la comparación que antes no se podía hacer.
        collected: buildMetric({
          current: cobranzas.cobrado,
          previous: cobranzas.cobradoPrevio,
        }),
      },

      cobranzas: {
        facturado: cobranzas.facturado,
        cobrado: cobranzas.cobrado,
        brecha: cobranzas.brecha,
        devuelto: cobranzas.devuelto,
        cobros: cobranzas.cobros,
        porVia: cobranzas.porVia,
      },

      caja,
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
          // Dos ventanas distintas a propósito, y hay que saberlo para leer el
          // `resultadoAproximado`: los cobros se cuentan por cuándo entró la plata
          // (`confirmedAt`), y los turnos de caja por cuándo se ABRIERON, enteros —
          // un turno noche que cierra a las 2 AM cuenta en el día que abrió y no se
          // parte, porque así lo nombra el negocio.
          collectedBasedOn: "PAYMENT_CONFIRMED_AT",
          cashBasedOn: "SESSION_OPENED_AT",
        },
      },
    };
  },
};
