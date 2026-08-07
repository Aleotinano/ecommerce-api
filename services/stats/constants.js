import { ORDER_STATUS_CODES } from "../order-status.js";

export const DAY_IN_MS = 24 * 60 * 60 * 1000;

// Sale del catálogo (services/order-status.js) y ya no es una lista propia: tiene
// que cubrir TODO el enum `OrderStatus` —`buildOrderStatusPanel` arma la
// distribución mapeando esto, así que un estado que falte suma al total pero no
// aparece en el panel y los porcentajes dejan de cerrar en 100—, y mantener esa
// cobertura a mano era exactamente el error que se cometía al agregar un estado.
export const ORDER_STATUS_KEYS = ORDER_STATUS_CODES;
