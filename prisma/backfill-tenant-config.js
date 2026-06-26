// Crea una fila TenantConfig para cada tenant que no la tenga.
// Necesario para tenants creados antes de que el registro inicializara la config.
// Uso: node prisma/backfill-tenant-config.js
import prisma from "../lib/prisma.js";

const tenants = await prisma.tenant.findMany({
  where: { config: { is: null } },
  select: { id: true, name: true },
});

if (tenants.length === 0) {
  console.log("Todos los tenants ya tienen config. Nada que hacer.");
} else {
  for (const t of tenants) {
    await prisma.tenantConfig.create({
      data: { tenantId: t.id, storeName: t.name },
    });
    console.log(`✓ TenantConfig creada para tenant ${t.id} (${t.name})`);
  }
  console.log(`Listo: ${tenants.length} config(s) creada(s).`);
}

await prisma.$disconnect();
