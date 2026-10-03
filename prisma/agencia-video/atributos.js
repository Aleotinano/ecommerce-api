// Catálogo de atributos de variante de agencia-video: un solo eje, "Plan" (1 video,
// pack de 4, hasta 10 min…). Sin esto, las `attributes` de las variantes que carga
// ./productos.js serían keys que la tienda no reconoce: `validateAttributes` rechaza
// cualquier key fuera de este catálogo, así que el admin no podría editar un plan.
//   node prisma/agencia-video/atributos.js
//
// Un servicio con UN solo plan también lo lleva ({"plan": "Hasta 3 min"}): en una
// lista de precios de servicios el plan no es decorativo, es lo que se está
// cotizando, y la landing lo muestra al lado del precio.
//
// Va por Prisma y no por `TenantAttributeModel.setup` por el mismo motivo que
// pastaia/atributos.js: ese service es one-time y devuelve 409 en la segunda corrida.
import "dotenv/config";
import { pathToFileURL } from "node:url";

import prisma from "../../lib/prisma.js";
import { closeRedis } from "../../lib/redis.js";
import { del, delPattern, tenantNs } from "../../lib/cache.js";
import { requireTenant } from "./categorias.js";

const ATRIBUTOS = [{ key: "plan", label: "Plan", type: "TEXT" }];

export async function seedAgenciaVideoAtributos() {
  const tenant = await requireTenant();

  console.log("== Atributos de variante de agencia-video ==");

  for (const [position, atributo] of ATRIBUTOS.entries()) {
    const { key, label, type } = atributo;
    await prisma.tenantAttribute.upsert({
      where: { tenantId_key: { tenantId: tenant.id, key } },
      update: { label, type, position },
      create: { tenantId: tenant.id, key, label, type, position },
    });
  }

  // Mismas invalidaciones que hace el service al escribir el catálogo.
  await del(`${tenantNs(tenant.id)}:attrs`);
  await delPattern(`${tenantNs(tenant.id)}:prod:*`);

  console.log(`  ${ATRIBUTOS.length} atributo: ${ATRIBUTOS.map((a) => a.label).join(", ")}`);
  return ATRIBUTOS;
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  seedAgenciaVideoAtributos()
    .then(() => console.log("Listo: atributos de agencia-video sincronizados."))
    .catch((err) => {
      console.error(err.message ?? err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeRedis();
      await prisma.$disconnect();
    });
}
