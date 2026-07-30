import ExcelJS from "exceljs";

import { CASH_MOVEMENT_SIGN, signedAmount } from "./cash-register-math.js";

/**
 * Exportación del turno de caja a Excel.
 *
 * Reemplaza al "resumen imprimible" que estaba planeado: el arqueo termina en la
 * mano de un contador o en una carpeta, y un `.xlsx` sirve para las dos cosas
 * —abrirlo y sumar aparte, o imprimirlo— mientras un PDF solo sirve para una.
 *
 * Este módulo NO toca la base: recibe el turno ya cargado y devuelve un buffer.
 * Toda la aritmética viene de `cash-register-math.js`, así que el Excel no puede
 * decir un número distinto al que muestra la API.
 */

// Negativos en rojo y con paréntesis no: con signo, que es como se lee un arqueo.
const MONEY_FORMAT = '#,##0.00;[Red]-#,##0.00';
const DATETIME_FORMAT = "dd/mm/yyyy hh:mm";

const TYPE_LABELS = {
  ORDER_DEPOSIT: "Seña de orden",
  ORDER_PAYMENT: "Cobro de orden",
  ORDER_REFUND: "Devolución",
  INCOME: "Ingreso",
  EXPENSE: "Egreso",
};

const CHANNEL_LABELS = {
  CASH: "Efectivo",
  TRANSFER: "Transferencia",
  GATEWAY: "MercadoPago",
};

/**
 * Postgres guarda UTC; **una celda de fecha de Excel es hora de pared**, sin zona.
 * Escribir el `Date` crudo hacía que un turno abierto a las 19:44 se imprimiera
 * "22:44", que en un arqueo del día es directamente un dato equivocado.
 *
 * Se corrige al huso del **servidor**, que es donde opera el negocio. No hay
 * timezone por tenant en el modelo todavía (es el mismo agujero que tiene
 * `services/stats` para definir "hoy"); cuando exista, entra por acá.
 */
function toWallClock(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
}

function styleHeader(row) {
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
    cell.border = { bottom: { style: "thin", color: { argb: "FFBFBFBF" } } };
  });
}

/** Fila etiqueta/valor de la hoja de resumen del turno. */
function addField(sheet, label, value, { money = false, date = false } = {}) {
  const shown = date ? toWallClock(value) : value;
  const row = sheet.addRow([label, shown ?? "—"]);
  row.getCell(1).font = { bold: true };
  if (money && typeof value === "number") row.getCell(2).numFmt = MONEY_FORMAT;
  if (date && shown) row.getCell(2).numFmt = DATETIME_FORMAT;
  return row;
}

/**
 * @param {object} p
 * @param {object} p.session      turno con `movements` (y su `category`), `totals` y `summary`
 * @param {string} [p.storeName]  para encabezar la planilla
 * @param {string} [p.currency]
 * @param {Map<number,string>} [p.userNames] id → nombre, para no imprimir ids sueltos
 */
export async function buildSessionWorkbook({
  session,
  storeName = null,
  currency = "ARS",
  userNames = new Map(),
}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = storeName ?? "Caja";
  workbook.created = new Date();

  const quien = (id) => (id == null ? "—" : userNames.get(id) ?? `usuario #${id}`);
  const abierto = session.status === "OPEN";

  // ── Hoja 1: el turno y su arqueo ─────────────────────────────────────────
  const turno = workbook.addWorksheet("Turno");
  turno.columns = [{ width: 26 }, { width: 30 }];

  const titulo = turno.addRow([storeName ? `Caja — ${storeName}` : "Caja"]);
  titulo.font = { bold: true, size: 14 };
  turno.addRow([`Turno #${session.id}`, abierto ? "ABIERTO" : "CERRADO"]);
  turno.addRow([]);

  addField(turno, "Abrió", quien(session.openedById));
  addField(turno, "Fecha de apertura", session.openedAt, { date: true });
  addField(turno, `Efectivo de apertura (${currency})`, session.openingAmount, { money: true });
  addField(turno, "Nota de apertura", session.openingNote);
  turno.addRow([]);

  if (abierto) {
    // Un turno abierto no tiene arqueo: tiene un esperado, que todavía se mueve.
    addField(turno, "Cierre", "el turno sigue abierto");
    addField(turno, `Efectivo esperado (${currency})`, session.totals?.expectedCashAmount, {
      money: true,
    });
    addField(turno, `Transferencias (${currency})`, session.totals?.transferTotal, { money: true });
  } else {
    addField(turno, "Cerró", quien(session.closedById));
    addField(turno, "Fecha de cierre", session.closedAt, { date: true });
    addField(turno, `Efectivo esperado (${currency})`, session.expectedCashAmount, { money: true });
    addField(turno, `Efectivo contado (${currency})`, session.countedCashAmount, { money: true });

    const dif = addField(turno, `Diferencia (${currency})`, session.cashDifference, { money: true });
    // Es el número por el que se mira esta planilla.
    dif.getCell(2).font = {
      bold: true,
      color: { argb: (session.cashDifference ?? 0) < 0 ? "FFC00000" : "FF006100" },
    };

    addField(turno, `Transferencias (${currency})`, session.transferTotal, { money: true });
    addField(turno, "Nota de cierre", session.closingNote);
  }

  turno.addRow([]);
  addField(turno, "Movimientos", session.movements?.length ?? 0);
  addField(turno, "Exportado", new Date(), { date: true });

  // ── Hoja 2: el detalle ───────────────────────────────────────────────────
  const detalle = workbook.addWorksheet("Movimientos");
  detalle.columns = [
    { header: "Fecha", key: "fecha", width: 18 },
    { header: "Tipo", key: "tipo", width: 18 },
    { header: "Etiqueta", key: "etiqueta", width: 20 },
    { header: "Destinatario", key: "payee", width: 22 },
    { header: "Vía", key: "via", width: 15 },
    { header: `Monto (${currency})`, key: "monto", width: 16 },
    { header: "Orden", key: "orden", width: 10 },
    { header: "Nota", key: "nota", width: 34 },
    { header: "Registró", key: "quien", width: 20 },
  ];
  styleHeader(detalle.getRow(1));

  for (const movement of session.movements ?? []) {
    const row = detalle.addRow({
      fecha: toWallClock(movement.createdAt),
      tipo: TYPE_LABELS[movement.type] ?? movement.type,
      // Los movimientos de orden no llevan etiqueta: se explican por su tipo.
      etiqueta: movement.category?.label ?? "—",
      payee: movement.payee ?? "—",
      via: CHANNEL_LABELS[movement.channel] ?? movement.channel,
      // Con signo: el monto guardado es siempre positivo y el signo lo da el tipo.
      monto: signedAmount(movement),
      orden: movement.orderId ?? "—",
      nota: movement.note ?? "—",
      quien: quien(movement.createdById),
    });

    row.getCell("fecha").numFmt = DATETIME_FORMAT;
    row.getCell("monto").numFmt = MONEY_FORMAT;
  }

  detalle.autoFilter = { from: "A1", to: "I1" };
  detalle.views = [{ state: "frozen", ySplit: 1 }];

  // ── Hoja 3: en qué se fue la plata ───────────────────────────────────────
  const resumen = workbook.addWorksheet("Resumen");
  resumen.columns = [{ width: 26 }, { width: 16 }, { width: 12 }];

  const porEtiqueta = resumen.addRow(["Por etiqueta", `Total (${currency})`, "Movimientos"]);
  styleHeader(porEtiqueta);

  const etiquetas = Object.values(session.summary?.byCategory ?? {}).sort(
    (a, b) => a.total - b.total
  );

  if (etiquetas.length === 0) {
    resumen.addRow(["Sin movimientos etiquetados", 0, 0]).getCell(2).numFmt = MONEY_FORMAT;
  }

  for (const bucket of etiquetas) {
    const row = resumen.addRow([bucket.label ?? `#${bucket.categoryId}`, bucket.total, bucket.count]);
    row.getCell(2).numFmt = MONEY_FORMAT;
  }

  resumen.addRow([]);

  const porTipo = resumen.addRow(["Por tipo", `Total (${currency})`, ""]);
  styleHeader(porTipo);

  for (const [type, total] of Object.entries(session.summary?.byType ?? {})) {
    const row = resumen.addRow([TYPE_LABELS[type] ?? type, total, ""]);
    row.getCell(2).numFmt = MONEY_FORMAT;
  }

  resumen.addRow([]);

  const efectivo = Object.entries(session.summary?.byType ?? {}).length > 0;
  if (efectivo) {
    // Recordatorio impreso, porque es la pregunta que siempre aparece leyendo un
    // arqueo: las transferencias no están en el cajón.
    const nota = resumen.addRow(["Solo el efectivo entra al arqueo; las transferencias se informan aparte."]);
    nota.font = { italic: true, size: 9 };
  }

  return workbook;
}

/** El workbook como buffer, listo para escribir en la respuesta HTTP. */
export async function buildSessionXlsx(params) {
  const workbook = await buildSessionWorkbook(params);
  return workbook.xlsx.writeBuffer();
}

/** `caja-turno-7-2026-07-29.xlsx` */
export function sessionFileName(session) {
  const fecha = new Date(session.closedAt ?? session.openedAt).toISOString().slice(0, 10);
  return `caja-turno-${session.id}-${fecha}.xlsx`;
}

// Se exporta para el test que verifica que las etiquetas cubran el enum: una
// etiqueta faltante saldría como el valor crudo del enum en la planilla.
export { TYPE_LABELS, CHANNEL_LABELS, CASH_MOVEMENT_SIGN };
