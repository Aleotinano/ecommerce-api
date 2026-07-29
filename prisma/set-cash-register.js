// Habilita (o apaga) el MÓDULO DE CAJA de un tenant.
//
//   node prisma/set-cash-register.js <slug> on|off
//   node prisma/set-cash-register.js mesa-dulce on
//   node prisma/set-cash-register.js                  # lista el estado de cada tenant
//
// Al prender la caja siembra el catálogo de etiquetas por defecto (sueldos,
// insumos, proveedores…) si el tenant no tiene ninguna, para que no arranque con
// una pantalla vacía. Apagarla NO borra nada: los turnos y movimientos quedan.
//
// Va por script y no por endpoint a propósito, igual que los perfiles de flujo:
// cualquier ruta con `requireRole(["ADMIN"])` se la puede pegar el admin del
// tenant, y este flag decide si se puede cobrar sin caja abierta.
//
// OJO — prenderlo cambia la operación diaria: con la caja habilitada, confirmar un
// cobro en efectivo o por transferencia SIN turno abierto falla con
// CASH_SESSION_NOT_OPEN. Hay que avisarle al cliente antes, no que lo descubra un
// sábado a la mañana.
import "dotenv/config";
import { pathToFileURL } from "node:url";

import prisma from "../lib/prisma.js";
import { CashRegisterModel } from "../services/cash-register.js";

async function listAndExit() {
  const tenants = await prisma.tenant.findMany({
    select: {
      slug: true,
      config: { select: { cashRegisterEnabled: true } },
      _count: { select: { cashCategories: true, cashSessions: true } },
    },
    orderBy: { id: "asc" },
  });

  console.log("Tenants y estado de la caja:\n");
  for (const tenant of tenants) {
    const estado = tenant.config?.cashRegisterEnabled ? "ON " : "off";
    console.log(
      `  ${tenant.slug.padEnd(22)} ${estado}   ` +
        `etiquetas: ${tenant._count.cashCategories}   turnos: ${tenant._count.cashSessions}`
    );
  }
  console.log("\nUso: node prisma/set-cash-register.js <slug> on|off");
}

export async function setCashRegister(slug, enabled) {
  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, slug: true },
  });

  if (!tenant) {
    throw new Error(`Tenant "${slug}" no encontrado.`);
  }

  const before = await prisma.tenantConfig.findUnique({
    where: { tenantId: tenant.id },
    select: { cashRegisterEnabled: true },
  });

  if (!before) {
    throw new Error(
      `El tenant "${slug}" no tiene TenantConfig. Creála antes (el registro lo hace solo).`
    );
  }

  const after = await prisma.tenantConfig.update({
    where: { tenantId: tenant.id },
    data: { cashRegisterEnabled: enabled },
    select: { cashRegisterEnabled: true },
  });

  console.log(`Tenant: ${tenant.slug}`);
  console.log(`  caja antes:   ${before.cashRegisterEnabled ? "ON" : "off"}`);
  console.log(`  caja después: ${after.cashRegisterEnabled ? "ON" : "off"}`);

  if (enabled) {
    const { created, existing } = await CashRegisterModel.ensureDefaultCategories({
      tenantId: tenant.id,
    });

    console.log(
      created > 0
        ? `  etiquetas sembradas: ${created}`
        : `  etiquetas: ya tenía ${existing}, no se tocaron`
    );
  }

  return after;
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const [slug, estado] = process.argv.slice(2);

  const run = async () => {
    if (!slug || !estado) {
      await listAndExit();
      return;
    }

    if (!["on", "off"].includes(estado)) {
      throw new Error(`Estado inválido: "${estado}". Usá "on" u "off".`);
    }

    await setCashRegister(slug, estado === "on");
    console.log("\nListo.");
  };

  run()
    .catch((err) => {
      console.error(err.message ?? err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
