/**
 * Lo común a todas las planillas que emite el backoffice (arqueo de caja,
 * órdenes): formatos de celda, encabezados y cómo se responde un `.xlsx`.
 *
 * Vive acá y no en cada export porque la corrección de hora de pared no es un
 * detalle de estilo: es un dato que sale mal si se olvida, y ya se descubrió una
 * vez (ver `toWallClock`). Un export nuevo que importe de este módulo no puede
 * volver a equivocarse.
 */

/** Negativos en rojo y con signo, que es como se lee un arqueo. */
export const MONEY_FORMAT = "#,##0.00;[Red]-#,##0.00";
export const DATETIME_FORMAT = "dd/mm/yyyy hh:mm";

/**
 * Postgres guarda UTC; **una celda de fecha de Excel es hora de pared**, sin zona.
 * Escribir el `Date` crudo hacía que un turno abierto a las 19:44 se imprimiera
 * "22:44", que en un arqueo del día es directamente un dato equivocado.
 *
 * Se corrige al huso del **servidor**, que es donde opera el negocio. No hay
 * timezone por tenant en el modelo todavía (es el mismo agujero que tiene
 * `services/stats` para definir "hoy"); cuando exista, entra por acá.
 */
export function toWallClock(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
}

/**
 * `YYYY-MM-DD` del día **local**, para nombres de archivo. Con `toISOString()` un
 * turno abierto a las 22:00 (01:00 UTC del día siguiente) se llamaba con la fecha de
 * mañana, y un rango `to=2026-07-31` terminaba en "2026-08-01".
 */
export function isoDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `dd/mm/aaaa` del día local, o `null`. Para encabezados, no para celdas de dato. */
export function formatDay(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** Fila de encabezado: negrita, fondo gris y una línea abajo. */
export function styleHeader(row) {
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
    cell.border = { bottom: { style: "thin", color: { argb: "FFBFBFBF" } } };
  });
}

/** Fila etiqueta/valor de una hoja de resumen. */
export function addField(sheet, label, value, { money = false, date = false } = {}) {
  const shown = date ? toWallClock(value) : value;
  const row = sheet.addRow([label, shown ?? "—"]);
  row.getCell(1).font = { bold: true };
  if (money && typeof value === "number") row.getCell(2).numFmt = MONEY_FORMAT;
  if (date && shown) row.getCell(2).numFmt = DATETIME_FORMAT;
  return row;
}

/**
 * Responde un `.xlsx`. Se manda el buffer completo y no un stream: son decenas o
 * unos miles de filas, no un dataset — y así un error al armar la planilla sale
 * por el `errorHandler` normal en vez de cortar una respuesta a medio enviar.
 */
export function sendXlsx(res, buffer, filename) {
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  // El nombre del archivo lo necesita el front para mostrarlo (fetch + blob no
  // lee Content-Disposition sin exponerlo).
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

  return res.send(Buffer.from(buffer));
}
