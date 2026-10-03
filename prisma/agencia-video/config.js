// Ajustes de tienda de agencia-video sobre la TenantConfig que ya creó el alta.
// Idempotente: es un update de campos concretos.
//   pnpm tenant:create --name "Agencia Video" --email <email> --profile carta
//   pnpm seed:agencia-video
//
// Del lado del backend este tenant es SOLO el alta: el catálogo de servicios, los
// precios, el branding y los textos los carga el equipo desde el panel, y la landing
// se maqueta en el storefront. Por eso acá no hay categorías, productos ni copys:
// solo las dos perillas de operación que, mal puestas, dejan la landing vacía.
//
// NO toca el bloque de flujo de venta (storeMode, métodos de pago/entrega, seña): eso
// sale del perfil `carta` que se aplica al crear el tenant, y se corrige con
// `node prisma/set-tenant-profile.js agencia-video carta`. Ver [[Perfiles de flujo
// de venta]].
import "dotenv/config";
import { pathToFileURL } from "node:url";

import prisma from "../../lib/prisma.js";

const TENANT_SLUG = "agencia-video";

const CONFIG = {
  currency: "ARS",
  locale: "es-AR",
  customerPhoneCountry: "54",

  // Modo carta: no nacen órdenes desde la tienda, así que el stock de los servicios
  // no gobierna nada y lo natural es cargarlos en 0. Con el default `false`, un
  // catálogo en 0 se ve VACÍO (new-tenant-config.md §7).
  showOutOfStock: true,
  // Un servicio con varios planes (1 video / pack de 4…) es un producto con varias
  // variantes: el panel tiene que mostrar el alta de variantes.
  productVariantsEnabled: true,
};

async function requireTenant() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) {
    throw new Error(
      `Tenant "${TENANT_SLUG}" no encontrado. Creálo antes con:\n` +
        `  pnpm tenant:create --name "Agencia Video" --email <email> --profile carta\n` +
        `El slug sale del --name: con otro nombre, el slug (y esta constante) cambian.`
    );
  }
  return tenant;
}

export async function seedAgenciaVideoConfig() {
  const tenant = await requireTenant();

  console.log("== TenantConfig de agencia-video ==");

  const config = await prisma.tenantConfig.upsert({
    where: { tenantId: tenant.id },
    update: CONFIG,
    create: { tenantId: tenant.id, ...CONFIG },
    select: { id: true, storeName: true, storeMode: true, showOutOfStock: true },
  });

  console.log(
    `  config #${config.id} "${config.storeName}" — modo ${config.storeMode}, showOutOfStock ${config.showOutOfStock}`
  );

  if (config.storeMode !== "MENU") {
    console.warn(
      `  ⚠️  storeMode es "${config.storeMode}", no "MENU". La agencia cotiza por WhatsApp, no vende online:\n` +
        "      node prisma/set-tenant-profile.js agencia-video carta\n" +
        `      y borrá la key t${tenant.id}:config de Redis, o el storefront sigue viendo el modo viejo 10 minutos.`
    );
  }

  return config;
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  seedAgenciaVideoConfig()
    .then(() => console.log("Listo: config de agencia-video aplicada."))
    .catch((err) => {
      console.error(err.message ?? err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
