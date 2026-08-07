// Aplica un PERFIL DE FLUJO DE VENTA a un tenant existente.
//
//   node prisma/set-tenant-profile.js <slug> <perfil>
//   node prisma/set-tenant-profile.js mesa-dulce estandar
//   node prisma/set-tenant-profile.js                     # lista perfiles y tenants
//
// Es la herramienta de operación: estos campos NO se editan desde el panel
// (ver READONLY_TENANT_CONFIG_FIELDS en schemas/tenant-config.schema.js), porque el
// admin del tenant podría trabar pedidos que ya están en curso. Los configuramos
// nosotros, cliente por cliente.
//
// Idempotente: aplicar dos veces el mismo perfil no cambia nada. Solo toca los
// campos del perfil — branding, tema, SEO y contacto quedan intactos.
//
// Ojo: NO reescribe órdenes ya creadas. `requiresDeposit`/`depositAmount` son un
// snapshot por orden (ver OrderModel.create), así que activar la seña acá solo
// afecta a los pedidos nuevos. Es a propósito.
import "dotenv/config";
import { pathToFileURL } from "node:url";

import prisma from "../lib/prisma.js";
import {
  TENANT_PROFILES,
  TENANT_PROFILE_NAMES,
  resolveProfile,
} from "../services/tenant-profiles.js";

const PROFILE_FIELDS = [
  "storeMode",
  "paymentMethodsEnabled",
  "fulfillmentMethodsEnabled",
  "depositEnabled",
  "depositPercentage",
];

function formatFlow(config) {
  if (!config) return "(sin config)";
  // El modo va primero y con nombre en castellano: es lo primero que hay que
  // mirar en la lista, porque en "carta" el resto de la línea no gobierna nada.
  return [
    `modo: ${config.storeMode === "MENU" ? "carta (sin carrito)" : "tienda"}`,
    `pagos: ${(config.paymentMethodsEnabled ?? []).join(",") || "—"}`,
    `entregas: ${(config.fulfillmentMethodsEnabled ?? []).join(",") || "—"}`,
    `seña: ${config.depositEnabled ? `sí (${config.depositPercentage}%)` : "no"}`,
  ].join(" | ");
}

async function listAndExit() {
  console.log("Perfiles disponibles:\n");
  for (const [name, values] of Object.entries(TENANT_PROFILES)) {
    console.log(`  ${name.padEnd(22)} ${formatFlow(values)}`);
  }

  const tenants = await prisma.tenant.findMany({
    select: {
      slug: true,
      config: {
        select: {
          storeMode: true,
          paymentMethodsEnabled: true,
          fulfillmentMethodsEnabled: true,
          depositEnabled: true,
          depositPercentage: true,
        },
      },
    },
    orderBy: { id: "asc" },
  });

  console.log("\nTenants y su flujo actual:\n");
  for (const tenant of tenants) {
    console.log(`  ${tenant.slug.padEnd(22)} ${formatFlow(tenant.config)}`);
  }
  console.log("\nUso: node prisma/set-tenant-profile.js <slug> <perfil>");
}

export async function setTenantProfile(slug, profileName) {
  // Lanza con TENANT_PROFILE_UNKNOWN si el nombre no existe: un typo no debería
  // dejar al tenant con la config de otro flujo de negocio.
  const values = resolveProfile(profileName);

  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, slug: true },
  });

  if (!tenant) {
    throw new Error(`Tenant "${slug}" no encontrado.`);
  }

  const select = Object.fromEntries(PROFILE_FIELDS.map((f) => [f, true]));

  const before = await prisma.tenantConfig.findUnique({
    where: { tenantId: tenant.id },
    select,
  });

  if (!before) {
    throw new Error(
      `El tenant "${slug}" no tiene TenantConfig. Creálo antes (el registro lo crea solo).`
    );
  }

  const after = await prisma.tenantConfig.update({
    where: { tenantId: tenant.id },
    data: values,
    select,
  });

  console.log(`Tenant: ${tenant.slug}   Perfil: ${profileName}`);
  console.log(`  antes:   ${formatFlow(before)}`);
  console.log(`  después: ${formatFlow(after)}`);

  return after;
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const [slug, profileName] = process.argv.slice(2);

  const run = async () => {
    if (!slug || !profileName) {
      await listAndExit();
      return;
    }
    await setTenantProfile(slug, profileName);
    console.log("\nListo.");
  };

  run()
    .catch((err) => {
      console.error(err.message ?? err);
      if (err.code === "TENANT_PROFILE_UNKNOWN") {
        console.error(`Perfiles válidos: ${TENANT_PROFILE_NAMES.join(", ")}`);
      }
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
