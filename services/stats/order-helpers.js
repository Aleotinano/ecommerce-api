/** Determina si una orden debe considerarse venta cerrada para analytics. */
export const isCompletedOrder = (order) => order.status === "COMPLETED";

/** Suma las unidades de todos los items de una orden. */
export const getOrderUnits = (order) =>
  order.orderItems.reduce((total, item) => total + item.quantity, 0);

/** Obtiene el total de ingresos de ordenes completadas. */
export const sumCompletedRevenue = (orders) =>
  orders.reduce(
    (total, order) => total + (isCompletedOrder(order) ? order.total : 0),
    0
  );

/** Obtiene el total de unidades vendidas en ordenes completadas. */
export const sumCompletedUnits = (orders) =>
  orders.reduce(
    (total, order) => total + (isCompletedOrder(order) ? getOrderUnits(order) : 0),
    0
  );
