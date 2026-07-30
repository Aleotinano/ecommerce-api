/**
 * Números del almacenamiento privado. Constantes y no configuración, mismo
 * criterio que `AUTO_CLOSE_GRACE_MINUTES` en services/cash-register-schedule.js:
 * si algún cliente pide otro valor, ahí se discute — no se agrega una perilla que
 * después nadie sabe en cuánto está.
 */

/** Proveedor con el que se sube todo lo nuevo. Las filas viejas traen el suyo. */
export const DEFAULT_STORAGE_PROVIDER = "cloudinary";

/**
 * Cuánto vive una URL firmada de comprobante. Diez minutos alcanza de sobra para
 * abrirla y mirarla, y es poco para que sirva si se filtra (una captura del panel,
 * el historial del navegador, un log). No se guarda ninguna URL en la base: se
 * emite una nueva en cada respuesta.
 */
export const SIGNED_URL_TTL_SECONDS = 10 * 60;

/**
 * Cuánto se conserva un comprobante antes de que la purga lo borre del proveedor
 * (`purgeExpired`, services/order-receipts.js). Doce meses cubre cualquier disputa
 * razonable sobre un pedido; más allá de eso es guardar el CBU y el nombre de una
 * persona sin motivo.
 */
export const RECEIPT_RETENTION_MONTHS = 12;
