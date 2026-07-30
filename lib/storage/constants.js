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
 * Ventana por defecto de `purgeExpired` (services/order-receipts.js).
 *
 * **No es una política que el sistema aplique**: hoy NADA borra comprobantes solo.
 * El borrado es manual desde el panel, y `pnpm receipts:purge` existe como
 * herramienta por si algún cliente pide una retención — sin engancharse a ningún
 * cron. Ver [[Órdenes]] §Borrado y retención.
 *
 * El motivo de no purgar por default: el archivo que se guarda es el comprobante
 * que el comercio baja de SU cuenta de cobro, o sea respaldo contable de sus
 * ventas. Borrarlo a los N meses puede destruir documentación que el negocio
 * necesita conservar bastante más que eso.
 */
export const RECEIPT_RETENTION_MONTHS = 12;
