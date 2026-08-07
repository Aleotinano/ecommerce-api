import ExcelJS from "exceljs";

import {
  MONEY_FORMAT,
  DATETIME_FORMAT,
  addField,
  formatDay,
  isoDay,
  styleHeader,
  toWallClock,
} from "../helpers/xlsx.js";
import { paymentSummary } from "./order-state.js";
import { getStatusMeta } from "./order-status.js";

/**
 * Exportación de órdenes a Excel.
 *
 * Es el equivalente del arqueo de caja para el otro lado del mostrador: lo que
 * se vendió en un día, con el detalle de qué se pidió. Sirve para lo mismo —
 * abrirlo y sumar aparte, o imprimirlo y archivarlo.
 *
 * Este módulo NO toca la base: recibe las órdenes ya cargadas (con su libro de
 * cobros) y devuelve un buffer. Los montos cobrados salen de `paymentSummary`,
 * el mismo cálculo que usa la API, así que la planilla no puede decir un número
 * distinto al que muestra el panel.
 */

const FULFILLMENT_LABELS = {
  DELIVERY: "Envío",
  PICKUP: "Retiro",
};

const PAYMENT_METHOD_LABELS = {
  CASH: "Efectivo",
  TRANSFER: "Transferencia",
  MIXED: "Mixto",
};

const ORIGIN_LABELS = {
  ADMIN: "Mostrador",
  BOT: "WhatsApp",
  STORE: "Tienda",
};

/** Los atributos de una variante como texto: `{talle: "M"}` → "talle: M". */
function formatAttributes(attributes) {
  const entries = Object.entries(attributes ?? {});
  if (entries.length === 0) return null;
  return entries.map(([key, value]) => `${key}: ${value}`).join(", ");
}

/** Quién es el cliente: la cuenta registrada o, en las del bot, el contacto. */
function customerOf(order) {
  return order.user?.username ?? order.contactName ?? "Sin usuario";
}

/** Dónde va, para las de envío. Las de retiro no tienen a dónde ir. */
function addressOf(order) {
  if (order.fulfillmentMethod !== "DELIVERY") return "—";

  return (
    [order.addressText, order.addressDetails].filter(Boolean).join(" — ") ||
    order.addressMapsUrl ||
    "—"
  );
}

/**
 * @param {object} p
 * @param {Array}  p.orders  órdenes con `orderItems` (y su product/variant) y `payments`
 * @param {{from: Date|null, to: Date|null}} p.range
 * @param {string} [p.storeName]
 * @param {string} [p.currency]
 */
export async function buildOrdersWorkbook({
  orders = [],
  range = {},
  storeName = null,
  currency = "ARS",
}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = storeName ?? "Órdenes";
  workbook.created = new Date();

  // ── Hoja 1: un renglón por orden ─────────────────────────────────────────
  const hoja = workbook.addWorksheet("Órdenes");
  hoja.columns = [
    { header: "Fecha", key: "fecha", width: 18 },
    { header: "Orden", key: "id", width: 9 },
    { header: "Cliente", key: "cliente", width: 22 },
    { header: "Teléfono", key: "telefono", width: 16 },
    { header: "Estado", key: "estado", width: 14 },
    { header: "Entrega", key: "entrega", width: 10 },
    { header: "Dirección", key: "direccion", width: 34 },
    { header: "Pago", key: "pago", width: 15 },
    { header: `Total (${currency})`, key: "total", width: 14 },
    { header: `Cobrado (${currency})`, key: "cobrado", width: 14 },
    { header: `Pendiente (${currency})`, key: "pendiente", width: 14 },
    { header: "Ítems", key: "items", width: 8 },
    { header: "Origen", key: "origen", width: 12 },
  ];
  styleHeader(hoja.getRow(1));

  for (const order of orders) {
    const cobros = paymentSummary(order);

    const row = hoja.addRow({
      fecha: toWallClock(order.createdAt),
      id: order.id,
      cliente: customerOf(order),
      telefono: order.contactPhone ?? "—",
      estado: getStatusMeta(order.status).admin.label,
      entrega: FULFILLMENT_LABELS[order.fulfillmentMethod] ?? "—",
      direccion: addressOf(order),
      pago: PAYMENT_METHOD_LABELS[order.paymentMethod] ?? "—",
      total: order.total,
      cobrado: cobros.paid,
      pendiente: cobros.pending,
      items: order.orderItems?.length ?? 0,
      origen: ORIGIN_LABELS[order.origin] ?? order.origin,
    });

    row.getCell("fecha").numFmt = DATETIME_FORMAT;
    for (const key of ["total", "cobrado", "pendiente"]) {
      row.getCell(key).numFmt = MONEY_FORMAT;
    }

    // Lo que quedó sin cobrar es la razón por la que alguien mira esta planilla
    // una semana después.
    if (cobros.pending > 0) {
      row.getCell("pendiente").font = { bold: true, color: { argb: "FFC00000" } };
    }
  }

  hoja.autoFilter = { from: "A1", to: "M1" };
  hoja.views = [{ state: "frozen", ySplit: 1 }];

  // ── Hoja 2: qué se pidió ─────────────────────────────────────────────────
  const detalle = workbook.addWorksheet("Ítems");
  detalle.columns = [
    { header: "Orden", key: "orden", width: 9 },
    { header: "Fecha", key: "fecha", width: 18 },
    { header: "Producto", key: "producto", width: 34 },
    { header: "Variante", key: "variante", width: 22 },
    { header: "Cantidad", key: "cantidad", width: 10 },
    { header: `Unitario (${currency})`, key: "unitario", width: 14 },
    { header: `Subtotal (${currency})`, key: "subtotal", width: 14 },
    { header: "Nota", key: "nota", width: 30 },
  ];
  styleHeader(detalle.getRow(1));

  for (const order of orders) {
    for (const item of order.orderItems ?? []) {
      const row = detalle.addRow({
        orden: order.id,
        fecha: toWallClock(order.createdAt),
        producto: item.product?.name ?? item.variant?.sku ?? "—",
        variante: formatAttributes(item.variant?.attributes) ?? "—",
        cantidad: item.quantity,
        unitario: item.price,
        subtotal: item.price * item.quantity,
        nota: item.note ?? "—",
      });

      row.getCell("fecha").numFmt = DATETIME_FORMAT;
      row.getCell("unitario").numFmt = MONEY_FORMAT;
      row.getCell("subtotal").numFmt = MONEY_FORMAT;
    }
  }

  detalle.autoFilter = { from: "A1", to: "H1" };
  detalle.views = [{ state: "frozen", ySplit: 1 }];

  // ── Hoja 3: los totales del período ──────────────────────────────────────
  const resumen = workbook.addWorksheet("Resumen");
  resumen.columns = [{ width: 28 }, { width: 16 }, { width: 12 }];

  const titulo = resumen.addRow([
    storeName ? `Órdenes — ${storeName}` : "Órdenes",
  ]);
  titulo.font = { bold: true, size: 14 };

  // El rango va como TEXTO dd/mm/aaaa y no como fecha: es el día que se pidió,
  // no un instante, y pasarlo por `toWallClock` lo correría un día.
  addField(resumen, "Desde", formatDay(range.from) ?? "sin límite");
  addField(resumen, "Hasta", formatDay(range.to) ?? "sin límite");
  addField(resumen, "Órdenes", orders.length);
  addField(resumen, "Exportado", new Date(), { date: true });
  resumen.addRow([]);

  const porEstado = resumen.addRow(["Por estado", "Órdenes", `Total (${currency})`]);
  styleHeader(porEstado);

  // Las canceladas cuentan como fila pero no como venta: van con su total igual
  // que las demás y se leen aparte, que es lo que hace el panel.
  const buckets = new Map();
  for (const order of orders) {
    const label = getStatusMeta(order.status).admin.label;
    const bucket = buckets.get(label) ?? { count: 0, total: 0 };
    bucket.count += 1;
    bucket.total += order.total ?? 0;
    buckets.set(label, bucket);
  }

  if (buckets.size === 0) {
    resumen.addRow(["Sin órdenes en el período", 0, 0]).getCell(3).numFmt =
      MONEY_FORMAT;
  }

  for (const [label, bucket] of buckets) {
    const row = resumen.addRow([label, bucket.count, bucket.total]);
    row.getCell(3).numFmt = MONEY_FORMAT;
  }

  resumen.addRow([]);

  const cobrado = orders.reduce((sum, order) => sum + paymentSummary(order).paid, 0);
  const pendiente = orders.reduce(
    (sum, order) => sum + paymentSummary(order).pending,
    0
  );

  addField(resumen, `Cobrado (${currency})`, cobrado, { money: true });
  const falta = addField(resumen, `Pendiente (${currency})`, pendiente, {
    money: true,
  });
  if (pendiente > 0) {
    falta.getCell(2).font = { bold: true, color: { argb: "FFC00000" } };
  }

  const nota = resumen.addRow([
    "El pendiente incluye las órdenes canceladas que no se cobraron.",
  ]);
  nota.font = { italic: true, size: 9 };

  return workbook;
}

/** El workbook como buffer, listo para escribir en la respuesta HTTP. */
export async function buildOrdersXlsx(params) {
  const workbook = await buildOrdersWorkbook(params);
  return workbook.xlsx.writeBuffer();
}

/**
 * `ordenes-2026-08-01.xlsx` cuando el rango es un día (que es el caso normal:
 * el botón del admin baja el día de hoy), `ordenes-2026-07-01_2026-07-31.xlsx`
 * cuando abarca varios.
 */
export function ordersFileName({ from, to }) {
  const desde = from ? isoDay(from) : "todo";
  const hasta = to ? isoDay(to) : "todo";

  return desde === hasta
    ? `ordenes-${desde}.xlsx`
    : `ordenes-${desde}_${hasta}.xlsx`;
}

// Se exportan para el test que verifica que las etiquetas cubran los enums: una
// etiqueta faltante saldría como el valor crudo en la planilla.
export { FULFILLMENT_LABELS, PAYMENT_METHOD_LABELS, ORIGIN_LABELS };
