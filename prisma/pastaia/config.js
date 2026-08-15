// Branding y preferencias de tienda de Pastaia sobre la TenantConfig que ya creó el
// alta. Idempotente: es un update de campos concretos.
//   node prisma/pastaia/config.js
//
// NO toca el bloque de flujo de venta (storeMode, métodos de pago/entrega, seña): eso
// sale del perfil `estandar` que se aplica al crear el tenant, y se corrige con
// `node prisma/set-tenant-profile.js pastaia estandar`. Ver [[Perfiles de flujo de
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
  storeName: "Pastaia",
  storeTagline: "Pastas caseras congeladas",
  // El horario va embebido acá porque TenantConfig NO tiene campo de horarios de
  // atención (mismo workaround que maikai).
  storeDescription:
    "Sorrentinos, ravioles y raviolones caseros, congelados y listos para cocinar. Elegí masa, relleno y el tamaño de la caja: 12, 24 o 48 unidades. Entregas a domicilio de martes a domingo.",

  seoTitle: "Pastaia — Pastas caseras congeladas con envío",
  seoDescription:
    "Sorrentinos, ravioles y raviolones caseros congelados. Masas clásica, de remolacha y de albahaca, cuatro rellenos y salsas. Cajas de 12, 24 y 48. Envíos de martes a domingo.",
  seoKeywords:
    "pastas congeladas, sorrentinos, ravioles, raviolones, pastas caseras, pastas frescas, delivery de pastas, masa de remolacha, masa de albahaca, salsa casera",

  // Solo con lo que sabemos: la zona de cobertura y el costo del envío todavía no los
  // tenemos, y no hay campos propios para eso en el modelo (ver la ficha del tenant).
  shippingPolicy:
    "Entregamos a domicilio de martes a domingo. Los pedidos se despachan congelados; conviene guardarlos en el freezer apenas llegan.",

  currency: "ARS",
  locale: "es-AR",
  customerPhoneCountry: "54",

  // El catálogo arranca con stock 999 por variante (ver ./productos.js): esto es para
  // que una variante que se agote no desaparezca de la carta mientras se repone.
  showOutOfStock: true,
  // Cada pasta tiene 9 variantes (3 masas x 3 cajas): el panel tiene que mostrar el
  // alta de variantes sí o sí.
  productVariantsEnabled: true,
};

export async function seedPastaiaConfig() {
  const tenant = await requireTenant();

  console.log("== TenantConfig de pastaia ==");

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
      `  ⚠️  storeMode es "${config.storeMode}", no "SHOP". Pastaia vende:\n` +
        "      node prisma/set-tenant-profile.js pastaia estandar"
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
  seedPastaiaConfig()
    .then(() => console.log("Listo: config de pastaia aplicada."))
    .catch((err) => {
      console.error(err.message ?? err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
