// Branding y preferencias de tienda de agencia-video sobre la TenantConfig que ya
// creó el alta. Idempotente: es un update de campos concretos.
//   node prisma/agencia-video/config.js
//
// NO toca el bloque de flujo de venta (storeMode, métodos de pago/entrega, seña): eso
// sale del perfil `carta` que se aplica al crear el tenant, y se corrige con
// `node prisma/set-tenant-profile.js agencia-video carta`. Ver [[Perfiles de flujo
// de venta]].
//
// `storeName` NO va acá: lo pone `pnpm tenant:create --name`, y el nombre real de la
// agencia todavía no está decidido. Cuando lo esté se cambia desde el panel, y si
// este seed lo declarara lo pisaría en cada corrida.
//
// Contacto (contactEmail, contactPhone, socialWhatsapp, socialInstagram,
// socialTiktok, socialYoutube) queda SIN cargar: se OMITE en vez de ir en null,
// porque `update: CONFIG` pisa todo lo que declare y un null borraría lo cargado
// desde el panel. Mientras falte, el storefront usa el fallback de su content.ts.
import "dotenv/config";
import { pathToFileURL } from "node:url";

import prisma from "../../lib/prisma.js";
import { requireTenant } from "./categorias.js";

const CONFIG = {
  storeTagline: "Edición de video para marcas, creadores y eventos",
  storeDescription:
    "Editamos tus videos para redes, YouTube, podcasts, eventos y publicidad. Vos grabás, nosotros lo convertimos en contenido. Precios por plan, a la vista.",

  seoTitle: "Edición de video para redes, YouTube y eventos — precios y planes",
  seoDescription:
    "Agencia de edición de video: Reels y TikTok, YouTube, podcasts en video, casamientos y 15, spots publicitarios. Mirá los planes y precios y pedí tu presupuesto por WhatsApp.",
  seoKeywords:
    "edición de video, editor de video, edición de reels, edición tiktok, edición youtube, podcast en video, video de casamiento, video de 15, aftermovie, spot publicitario, motion graphics",

  currency: "ARS",
  locale: "es-AR",
  customerPhoneCountry: "54",

  // Modo carta con stock 0 en todos los planes (ver ./productos.js): sin esto, el
  // default `false` esconde el catálogo entero y la sección de precios queda vacía.
  showOutOfStock: true,
  // Casi todos los servicios tienen más de un plan: el panel tiene que mostrar el
  // alta de variantes.
  productVariantsEnabled: true,
};

export async function seedAgenciaVideoConfig() {
  const tenant = await requireTenant();

  console.log("== TenantConfig de agencia-video ==");

  const config = await prisma.tenantConfig.upsert({
    where: { tenantId: tenant.id },
    update: CONFIG,
    create: { tenantId: tenant.id, ...CONFIG },
    select: {
      id: true,
      storeName: true,
      storeMode: true,
      showOutOfStock: true,
      socialWhatsapp: true,
    },
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

  if (!config.socialWhatsapp) {
    console.warn(
      "  ⚠️  socialWhatsapp sin cargar: los botones de cotizar usan el número de respaldo del storefront."
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
