// Órdenes de demo del customer de mesa-dulce, cubriendo el ciclo de vida del
// pedido (pendiente → en producción → listo → completado, más una cancelada) y
// los TRES métodos de pago que usa el negocio.
//
// Sin seña: el tenant tiene depositEnabled=false (ver seed-tenant-config.js). El
// dinero de cada orden queda registrado en el libro de cobros (`OrderPayment`), y
// `paymentStatus` se deriva de ahí — igual que en runtime, ver
// `buildPaymentPlan` en seed-helpers.
//   node prisma/mesa-dulce/ordenes.js
//
// NO SIRVE PARA PROBAR CAJA: las filas del libro se escriben directo con
// `prisma.order.create`, salteándose `recordOrderPayments`, así que estas órdenes
// nacen cobradas y la caja no se entera nunca — cero `CashMovement`, arqueo vacío.
// Es deliberado: este seed puebla el tablero de órdenes y tiene que poder correr en
// un tenant sin caja. Para caja está `prisma/seed-caja.js`, que cobra por los
// services reales.
//
// No es estrictamente idempotente (una orden no tiene una clave de negocio
// natural para dedup exacto) pero evita duplicar en un rerun accidental: si
// el customer ya tiene órdenes de este seed, se salta por completo.
import "dotenv/config";
import { pathToFileURL } from "node:url";

import prisma from "../../lib/prisma.js";
import { seedOrdersForUser } from "../lib/seed-helpers.js";

const TENANT_SLUG = "mesa-dulce";

const ORDERS = [
  // Recién entrada, retira y paga en el local: no hay nada cobrado todavía.
  {
    status: "NEW",
    daysAgo: 1,
    paymentMethod: "CASH",
    fulfillmentMethod: "PICKUP",
    items: [{ sku: "COR-KIN", quantity: 2 }, { sku: "BRW-CLS", quantity: 1 }],
  },
  // En producción porque la transferencia YA entró: es la condición que la
  // destraba cuando el tenant no cobra seña.
  {
    status: "PROCESSING",
    daysAgo: 3,
    paymentMethod: "TRANSFER",
    fulfillmentMethod: "DELIVERY",
    addressText: "Av. Libertador San Martín 1250, San Juan",
    addressDetails: "Portón negro, tocar timbre",
    items: [{ sku: "COR-FRA", quantity: 3 }, { sku: "COC-CHI", quantity: 6 }],
  },
  // Lista para entregar, pago mixto: la parte transferida entró (por eso se
  // produjo); el efectivo se cobra cuando el repartidor la deja.
  {
    status: "READY",
    daysAgo: 2,
    paymentMethod: "MIXED",
    transferShare: 0.5,
    fulfillmentMethod: "DELIVERY",
    addressText: "Rivadavia 480, Rivadavia, San Juan",
    items: [{ sku: "COR-LIM", quantity: 1 }, { sku: "COC-ORE", quantity: 12 }],
  },
  // Entregada y cobrada en el mostrador, todo en efectivo.
  {
    status: "COMPLETED",
    daysAgo: 10,
    paymentMethod: "CASH",
    fulfillmentMethod: "PICKUP",
    items: [{ sku: "BRW-ORE", quantity: 4 }, { sku: "COC-RVL", quantity: 6 }],
  },
  // Cancelada antes de que entrara la plata: queda sin cobros. Si se cancela una
  // ya cobrada, la devolución se carga a mano (`kind: REFUND`).
  {
    status: "CANCELLED",
    daysAgo: 6,
    paymentMethod: "TRANSFER",
    fulfillmentMethod: "PICKUP",
    items: [{ sku: "COR-LIM", quantity: 2 }],
  },
  // Mixta ya cerrada: dos filas en el libro que suman el total.
  {
    status: "COMPLETED",
    daysAgo: 20,
    paymentMethod: "MIXED",
    transferShare: 0.4,
    fulfillmentMethod: "DELIVERY",
    addressText: "Sarmiento 95 sur, Capital, San Juan",
    items: [{ sku: "COC-ORE", quantity: 10 }],
  },
];

export async function seedMesaDulceOrdenes() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) {
    throw new Error(
      `Tenant "${TENANT_SLUG}" no encontrado. Corré primero "pnpm seed" (o creá el tenant a mano) antes de este script.`
    );
  }

  const [customer, admin] = await Promise.all([
    prisma.user.findFirst({ where: { tenantId: tenant.id, role: "CUSTOMER" } }),
    prisma.user.findFirst({ where: { tenantId: tenant.id, role: "ADMIN" } }),
  ]);
  if (!customer || !admin) {
    throw new Error(`Faltan usuarios CUSTOMER/ADMIN de "${TENANT_SLUG}" — corré primero "pnpm seed".`);
  }

  console.log("== Órdenes de demo de mesa-dulce ==");

  const alreadySeeded = await prisma.order.findFirst({
    where: { tenantId: tenant.id, userId: customer.id, paymentId: { startsWith: "seed-order-" } },
  });
  if (alreadySeeded) {
    console.log("  -> el customer ya tiene órdenes de demo cargadas, se omite (evita duplicar)");
    console.log(
      '     Para regenerarlas con los datos nuevos, borrá primero las viejas:\n' +
        '     DELETE FROM "Order" WHERE "paymentId" LIKE \'seed-order-%\' AND "tenantId" = ' +
        `${tenant.id};`
    );
    return 0;
  }

  const created = await seedOrdersForUser({
    tenantId: tenant.id,
    userId: customer.id,
    orders: ORDERS,
    depositPercentage: 50,
    reviewerId: admin.id,
  });
  console.log(`  -> ${created} órdenes creadas`);
  return created;
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  seedMesaDulceOrdenes()
    .then(() => console.log("Listo: órdenes de demo de mesa-dulce sincronizadas."))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
