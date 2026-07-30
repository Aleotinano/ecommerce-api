import path from "node:path";

import prisma from "../lib/prisma.js";
import { createError } from "../helpers/error.js";
import { logger } from "../lib/logger.js";
import {
  deleteFile,
  putFile,
  signedUrl,
  RECEIPT_RETENTION_MONTHS,
} from "../lib/storage/index.js";

const log = logger.child({ module: "order-receipts" });

/**
 * Comprobantes de transferencia de una orden.
 *
 * Hasta acá, confirmar una transferencia sellaba **cuándo** y **quién**
 * (`transferConfirmedAt`/`ById`) pero no dejaba rastro de **qué se miró** para
 * decidirlo. Esto guarda ese archivo.
 *
 * Tres cosas que no hace, a propósito:
 *
 * 1. **No confirma nada.** Subir un comprobante es cargar evidencia; la
 *    confirmación la sigue haciendo una persona que mira la cuenta bancaria. Un
 *    comprobante se falsifica en dos minutos, y además confirmar dispara el avance
 *    automático de la orden (`applyAutoAdvance`).
 * 2. **No exige que la orden sea TRANSFER/MIXED.** El método de pago puede cambiar
 *    después (por `review`), y trabar la carga de la evidencia por eso sería
 *    molestar al admin sin proteger nada.
 * 3. **No guarda una URL usable.** Un comprobante lleva CBU, nombre y a veces el
 *    saldo de la cuenta; las URLs se emiten firmadas y con vencimiento en cada
 *    respuesta (ver `lib/storage`).
 *
 * Vive aparte de `services/orders.js` nada más que por tamaño: aquel ya pasa las
 * 1400 líneas.
 */

const RECEIPT_ENTITY = "receipts";

/** `"comprobante.PDF"` → `"pdf"`. `null` si el nombre no trae extensión. */
function extensionOf(filename) {
  const ext = path.extname(filename ?? "").replace(".", "").toLowerCase();
  return ext || null;
}

/** Lo que sale hacia el controller. Nunca incluye `publicId`. */
function toPublic(receipt) {
  return {
    id: receipt.id,
    orderId: receipt.orderId,
    orderPaymentId: receipt.orderPaymentId,
    mimeType: receipt.mimeType,
    resourceType: receipt.resourceType,
    // El panel necesita saberlo para decidir entre <img> y un link: los PDF se
    // suben como `raw` y no tienen miniatura.
    isPdf: receipt.mimeType === "application/pdf",
    bytes: receipt.bytes,
    originalName: receipt.originalName,
    note: receipt.note,
    uploadedById: receipt.uploadedById,
    createdAt: receipt.createdAt,
    url: signedUrl(receipt),
  };
}

async function findOrderOrThrow(tenantId, orderId, client = prisma) {
  const order = await client.order.findFirst({
    where: { id: Number(orderId), tenantId },
    select: { id: true },
  });

  if (!order) {
    throw createError("Orden no encontrada", "ORDER_NOT_FOUND", 404);
  }

  return order;
}

export const OrderReceiptModel = {
  /**
   * Sube el archivo y lo cuelga de la orden. Nace con `orderPaymentId: null`
   * —evidencia cargada, todavía sin confirmar—; lo enlaza `applyPayments` cuando
   * alguien confirma usando este comprobante.
   *
   * @param {object} p.file el `req.files.receipt[0]` de multer
   */
  async addReceipt({ tenantId, orderId, file, uploadedById = null, note = null }) {
    if (!file) {
      throw createError(
        "Falta el archivo del comprobante",
        "RECEIPT_FILE_REQUIRED",
        400
      );
    }

    // Antes de subir nada: si la orden no existe, no tiene sentido gastar una
    // llamada al proveedor ni dejar un archivo huérfano allá.
    const order = await findOrderOrThrow(tenantId, orderId);

    const stored = await putFile(file.path, {
      tenantId,
      entity: RECEIPT_ENTITY,
      access: "private",
      mimeType: file.mimetype,
    });

    return prisma.orderReceipt.create({
      data: {
        tenantId,
        orderId: order.id,
        storageProvider: stored.storageProvider,
        publicId: stored.publicId,
        resourceType: stored.resourceType,
        deliveryType: stored.deliveryType,
        // En `raw` Cloudinary suele no devolver `format`; la extensión del archivo
        // original alcanza para armar la URL de descarga.
        format: stored.format ?? extensionOf(file.originalname),
        mimeType: file.mimetype,
        bytes: stored.bytes || file.size || 0,
        originalName: file.originalname ?? null,
        note,
        uploadedById,
      },
    });
  },

  /** Comprobantes vivos de la orden, con su URL firmada recién emitida. */
  async listReceipts({ tenantId, orderId }) {
    await findOrderOrThrow(tenantId, orderId);

    const receipts = await prisma.orderReceipt.findMany({
      where: { tenantId, orderId: Number(orderId), deletedAt: null },
      orderBy: { createdAt: "asc" },
    });

    return receipts.map(toPublic);
  },

  /**
   * Borra el archivo del proveedor y marca la fila.
   *
   * El orden importa: **primero el proveedor, después la fila**. Si el borrado
   * remoto falla, la fila NO se marca, así un reintento lo vuelve a intentar. Al
   * revés quedaría una orden diciendo "acá no hay nada" con el CBU de alguien vivo
   * en Cloudinary y sin nada que lo apunte.
   *
   * Soft-delete y no `delete`: que hubo un archivo —y que alguien lo borró— es
   * parte de la historia de la orden.
   */
  async removeReceipt({ tenantId, orderId, receiptId, deletedById = null }) {
    const receipt = await prisma.orderReceipt.findFirst({
      where: {
        id: Number(receiptId),
        tenantId,
        orderId: Number(orderId),
        deletedAt: null,
      },
    });

    if (!receipt) {
      throw createError("Comprobante no encontrado", "RECEIPT_NOT_FOUND", 404);
    }

    await deleteFile(receipt);

    return prisma.orderReceipt.update({
      where: { id: receipt.id },
      data: { deletedAt: new Date(), deletedById },
    });
  },

  /**
   * Borra del proveedor los comprobantes más viejos que la ventana y deja las filas
   * en soft-delete. Idempotente — los ya borrados no se vuelven a tocar—, así que se
   * puede correr las veces que sea.
   *
   * **Hoy no lo llama nadie automáticamente, a propósito.** El borrado normal es
   * manual desde el panel (`removeReceipt`); esto existe como herramienta por si
   * algún cliente pide una política de retención. No purgar por default es lo
   * correcto acá: el archivo que se guarda es el comprobante que el comercio baja de
   * SU cuenta de cobro, o sea respaldo contable de sus ventas.
   *
   * Si alguna vez se engancha, va por `scripts/purge-receipts.js` desde el cron del
   * host y no como job del proceso — el proyecto no tiene scheduler y tiene una
   * postura escrita en contra (ver services/cash-register-schedule.js).
   *
   * Un fallo del proveedor sobre una fila no corta la corrida: se loguea y sigue,
   * y la próxima pasada la vuelve a agarrar porque quedó sin marcar.
   */
  async purgeExpired({ olderThanMonths = RECEIPT_RETENTION_MONTHS } = {}) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - olderThanMonths);

    const expired = await prisma.orderReceipt.findMany({
      where: { deletedAt: null, createdAt: { lt: cutoff } },
    });

    let purged = 0;
    const failed = [];

    for (const receipt of expired) {
      try {
        await deleteFile(receipt);
        await prisma.orderReceipt.update({
          where: { id: receipt.id },
          data: { deletedAt: new Date() },
        });
        purged += 1;
      } catch (error) {
        failed.push(receipt.id);
        log.error(
          { err: error, receiptId: receipt.id },
          "no se pudo purgar el comprobante"
        );
      }
    }

    return { found: expired.length, purged, failed, cutoff };
  },
};

export { toPublic as toPublicReceipt };
