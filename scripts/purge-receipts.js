import prisma from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { RECEIPT_RETENTION_MONTHS } from "../lib/storage/index.js";
import { OrderReceiptModel } from "../services/order-receipts.js";

/**
 * Retención de comprobantes: borra del proveedor los que superaron la ventana
 * (12 meses por defecto) y deja las filas en soft-delete.
 *
 * **Es un script, no un job del proceso.** El proyecto no tiene scheduler y tiene
 * una postura escrita en contra (ver services/cash-register-schedule.js): un job
 * perdido adentro del server es algo que se puede "no ejecutar" sin que nadie se
 * entere. Esto se engancha al cron del host, donde o está en el crontab o no está.
 *
 * Es idempotente: correrlo dos veces no hace nada la segunda.
 *
 *   pnpm receipts:purge
 *   pnpm receipts:purge -- --months=24
 *   pnpm receipts:purge -- --dry-run
 */

const log = logger.child({ module: "purge-receipts" });

function parseArgs(argv) {
  const monthsArg = argv.find((arg) => arg.startsWith("--months="));
  const months = monthsArg ? Number(monthsArg.split("=")[1]) : RECEIPT_RETENTION_MONTHS;

  if (!Number.isInteger(months) || months < 1) {
    throw new Error(`--months debe ser un entero positivo (recibí: ${monthsArg})`);
  }

  return { months, dryRun: argv.includes("--dry-run") };
}

async function main() {
  const { months, dryRun } = parseArgs(process.argv.slice(2));

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);

  if (dryRun) {
    const found = await prisma.orderReceipt.count({
      where: { deletedAt: null, createdAt: { lt: cutoff } },
    });

    log.info(
      { months, cutoff, found },
      "[dry-run] comprobantes que se borrarían (no se tocó nada)"
    );
    return;
  }

  const result = await OrderReceiptModel.purgeExpired({ olderThanMonths: months });

  log.info(
    { months, ...result },
    result.failed.length
      ? "purga terminada CON FALLOS: los no borrados se reintentan en la próxima corrida"
      : "purga terminada"
  );
}

main()
  .catch((error) => {
    log.error({ err: error }, "la purga de comprobantes falló");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
