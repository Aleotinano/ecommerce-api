// Catálogo de atributos de variante de Punto Healthy: "Presentación" (packs: x1, x6,
// x12, individual) y "Sabor" (los 10 del Smoothie, los 8 del Express, los 2 del
// Herbal Tea). Sin esto, las `attributes` de las variantes que carga ./productos.js
// serían keys que la tienda no reconoce: `validateAttributes` rechaza cualquier key
// fuera de este catálogo, así que el admin no podría editar una variante.
//   node prisma/punto-healthy/atributos.js
//
// Va por Prisma y no por `TenantAttributeModel.setup`: ese service es one-time y
// devuelve 409 si el catálogo ya existe (cambiar keys después dejaría inconsistentes
// las variantes ya escritas), lo que haría fallar la segunda corrida del seed. Acá se
// hace upsert por (tenantId, key) — que es exactamente lo mismo mientras las keys no
// cambien, y es lo único que este seed hace.
import "dotenv/config";
import { pathToFileURL } from "node:url";

import prisma from "../../lib/prisma.js";
import { closeRedis } from "../../lib/redis.js";
import { del, delPattern, tenantNs } from "../../lib/cache.js";
import { requireTenant } from "./categorias.js";

// El orden es el de display y el de normalización de las keys en las variantes.
const ATRIBUTOS = [
  { key: "presentacion", label: "Presentación", type: "TEXT" },
  { key: "sabor", label: "Sabor", type: "TEXT" },
];

export async function seedPuntoHealthyAtributos() {
  const tenant = await requireTenant();

  console.log("== Atributos de variante de punto-healthy ==");

  for (const [position, atributo] of ATRIBUTOS.entries()) {
    const { key, label, type } = atributo;
    await prisma.tenantAttribute.upsert({
      where: { tenantId_key: { tenantId: tenant.id, key } },
      update: { label, type, position },
      create: { tenantId: tenant.id, key, label, type, position },
    });
  }

  // Mismo par de invalidaciones que hace el service al escribir el catálogo: la
  // respuesta de atributos y el shape de opciones/filtros del storefront.
  await del(`${tenantNs(tenant.id)}:attrs`);
  await delPattern(`${tenantNs(tenant.id)}:prod:*`);

  console.log(`  ${ATRIBUTOS.length} atributos: ${ATRIBUTOS.map((a) => a.label).join(", ")}`);
  return ATRIBUTOS;
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  seedPuntoHealthyAtributos()
    .then(() => console.log("Listo: atributos de punto-healthy sincronizados."))
    .catch((err) => {
      console.error(err.message ?? err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeRedis();
      await prisma.$disconnect();
    });
}
