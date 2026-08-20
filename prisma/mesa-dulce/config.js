// Branding y preferencias de tienda de Mesa Dulce sobre la TenantConfig que ya creó el
// alta. Idempotente: es un update de campos concretos.
//   node prisma/mesa-dulce/config.js
//
// NO toca el bloque de flujo de venta (storeMode, métodos de pago/entrega, seña): eso
// sale del perfil `estandar` que se aplica al crear el tenant, y se corrige con
// `node prisma/set-tenant-profile.js mesa-dulce estandar`. Ver [[Perfiles de flujo de
// venta]].
//
// Los datos de contacto (contactEmail, contactPhone, contactAddress, socialWhatsapp,
// socialInstagram) y `customerPhoneArea` quedan SIN cargar: todavía no los tenemos.
// Se OMITEN en vez de ponerlos en null a propósito — `update: CONFIG` pisa todo lo
// que declare, así que un null acá borraría lo que se hubiera cargado desde el panel.
// Cuando lleguen, se agregan a este objeto.
import "dotenv/config";
import { pathToFileURL } from "node:url";

import prisma from "../../lib/prisma.js";
import { requireTenant } from "./categorias.js";

const CONFIG = {
  storeName: "Mesa Dulce",
  storeTagline: "Cookies, brownies y mesas dulces",
  // El horario va embebido acá porque TenantConfig NO tiene campo de horarios de
  // atención (mismo workaround que pastaia y maikai).
  storeDescription:
    "Cookies clásicas, cookies rellenas y brownies de autor, hechos por encargo. Armá tu combo eligiendo los sabores que quieras, o pedí por unidad para tu mesa dulce.",

  seoTitle: "Mesa Dulce — Cookies, brownies y combos por encargo",
  seoDescription:
    "Cookies clásicas y rellenas, brownies de autor y combos armados a elección. Pedidos por encargo para eventos y mesas dulces.",
  seoKeywords:
    "cookies, cookies rellenas, brownies, mesa dulce, combos de cookies, postres por encargo, red velvet, franui, cookies artesanales",

  currency: "ARS",
  locale: "es-AR",
  customerPhoneCountry: "54",

  // El catálogo arranca con stock alto por variante (ver ./productos.js) y esto es lo
  // que sostiene esa decisión: producen por encargo, no llevan inventario, así que una
  // variante en 0 tiene que seguir apareciendo en la carta en vez de desaparecer.
  showOutOfStock: true,
  // Cada producto tiene una sola variante `isDefault` (el sabor es el producto, no un
  // eje de elección): el panel no necesita mostrar el alta de variantes.
  productVariantsEnabled: false,
};

export async function seedMesaDulceConfig() {
  const tenant = await requireTenant();

  console.log("== TenantConfig de mesa-dulce ==");

  const config = await prisma.tenantConfig.upsert({
    where: { tenantId: tenant.id },
    update: CONFIG,
    create: { tenantId: tenant.id, ...CONFIG },
    select: {
      id: true,
      storeName: true,
      storeMode: true,
      showOutOfStock: true,
      contactPhone: true,
      contactAddress: true,
    },
  });

  console.log(
    `  config #${config.id} "${config.storeName}" — modo ${config.storeMode}, showOutOfStock ${config.showOutOfStock}`
  );

  if (config.storeMode !== "SHOP") {
    console.warn(
      `  ⚠️  storeMode es "${config.storeMode}", no "SHOP". Mesa Dulce vende:\n` +
        "      node prisma/set-tenant-profile.js mesa-dulce estandar"
    );
  }

  const pendientes = [
    !config.contactPhone && "contactPhone",
    !config.contactAddress && "contactAddress",
  ].filter(Boolean);

  if (pendientes.length) {
    console.warn(`  ⚠️  contacto sin cargar: ${pendientes.join(", ")} (ver el encabezado de este archivo)`);
  }

  return config;
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  seedMesaDulceConfig()
    .then(() => console.log("Listo: config de mesa-dulce aplicada."))
    .catch((err) => {
      console.error(err.message ?? err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
