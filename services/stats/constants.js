export const DAY_IN_MS = 24 * 60 * 60 * 1000;

// Tiene que cubrir TODO el enum `OrderStatus`: `buildOrderStatusPanel` arma la
// distribución mapeando esta lista, así que un estado que falte acá suma al total
// pero no aparece en el panel — y los porcentajes dejan de cerrar en 100.
export const ORDER_STATUS_KEYS = [
  "PENDING",
  "PROCESSING",
  "READY",
  "COMPLETED",
  "CANCELLED",
];
