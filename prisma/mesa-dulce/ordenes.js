// Órdenes de demo del customer de mesa-dulce, cubriendo el ciclo de vida de
// la seña (TenantConfig.depositEnabled=true, ver seed-tenant-config.js).
// requiresDeposit + depositPaid le dicen a seedOrdersForUser qué estado de
// pago armar; el resto (PENDING/CANCELLED sin seña pagada) usa el
// PAYMENT_BY_STATUS de siempre.
//   node prisma/mesa-dulce/ordenes.js
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
  // Recién creada: todavía espera que el cliente pague la seña.
  { status: "PENDING", daysAgo: 1, requiresDeposit: true, depositPaid: false, items: [{ sku: "COR-KIN", quantity: 2 }, { sku: "BRW-CLS", quantity: 1 }] },
  // Seña confirmada, ya en producción.
  { status: "PROCESSING", daysAgo: 3, requiresDeposit: true, depositPaid: true, items: [{ sku: "COR-FRA", quantity: 3 }, { sku: "COC-CHI", quantity: 6 }] },
  // Seña confirmada y saldo completado.
  { status: "COMPLETED", daysAgo: 10, requiresDeposit: true, depositPaid: true, items: [{ sku: "BRW-ORE", quantity: 4 }, { sku: "COC-RVL", quantity: 6 }] },
  // Se canceló antes de que el cliente llegara a pagar la seña.
  { status: "CANCELLED", daysAgo: 6, requiresDeposit: true, depositPaid: false, items: [{ sku: "COR-LIM", quantity: 2 }] },
  // Caso de contraste: orden vieja, creada antes de habilitar depositEnabled.
  { status: "COMPLETED", daysAgo: 20, requiresDeposit: false, items: [{ sku: "COC-ORE", quantity: 10 }] },
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
