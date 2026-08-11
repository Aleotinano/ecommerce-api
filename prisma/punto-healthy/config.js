// Branding y preferencias de tienda de Punto Healthy sobre la TenantConfig que ya
// creó el alta. Idempotente: es un update de campos concretos.
//   node prisma/punto-healthy/config.js
//
// NO toca el bloque de flujo de venta (storeMode, métodos de pago/entrega, seña): eso
// sale del perfil `estandar` que se aplica al crear el tenant, y se corrige con
// `node prisma/set-tenant-profile.js punto-healthy estandar`. Ver [[Perfiles de flujo
// de venta]].
//
// Los datos de contacto (teléfono, dirección, WhatsApp, Instagram) quedan SIN cargar:
// no los tenemos todavía y son por local — Punto Healthy es una franquicia. Se cargan
// desde el panel, o acá cuando el cliente los pase.
import "dotenv/config";
import { pathToFileURL } from "node:url";

import prisma from "../../lib/prisma.js";
import { requireTenant } from "./categorias.js";

const CONFIG = {
  storeName: "Punto Healthy",
  storeTagline: "Comida rápida saludable",
  storeDescription:
    "Bowls proteicos, smoothies, snacks sin harinas y bebidas funcionales. Alto en proteína, sin azúcar añadida y con todos los nutrientes que tu cuerpo necesita.",

  seoTitle: "Punto Healthy — Bowls proteicos, smoothies y snacks sin harinas",
  seoDescription:
    "Protein bowls, smoothies, snacks sin harinas ni azúcar añadida, bebidas funcionales y promos para llevar. Comida rápida saludable.",
  seoKeywords:
    "punto healthy, comida saludable, protein bowl, smoothie proteico, snacks sin harinas, bebidas funcionales, promos saludables",

  currency: "ARS",
  locale: "es-AR",
  customerPhoneCountry: "54",

  // El catálogo arranca con stock 100 por variante (ver ./productos.js): esto es para
  // que un producto que se agota no desaparezca de la carta mientras se repone.
  showOutOfStock: true,
  // Hay presentaciones (packs x1/x6/x12) y sabores (10 en el Smoothie): el panel tiene
  // que mostrar el alta de variantes.
  productVariantsEnabled: true,
};

export async function seedPuntoHealthyConfig() {
  const tenant = await requireTenant();

  console.log("== TenantConfig de punto-healthy ==");

  const config = await prisma.tenantConfig.upsert({
    where: { tenantId: tenant.id },
    update: CONFIG,
    create: { tenantId: tenant.id, ...CONFIG },
    select: { id: true, storeName: true, storeMode: true, showOutOfStock: true },
  });

  console.log(
    `  config #${config.id} "${config.storeName}" — modo ${config.storeMode}, showOutOfStock ${config.showOutOfStock}`
  );

  if (config.storeMode !== "SHOP") {
    console.warn(
      `  ⚠️  storeMode es "${config.storeMode}", no "SHOP". Punto Healthy vende (combos, promos, ticket):\n` +
        "      node prisma/set-tenant-profile.js punto-healthy estandar"
    );
  }

  return config;
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  seedPuntoHealthyConfig()
    .then(() => console.log("Listo: config de punto-healthy aplicada."))
    .catch((err) => {
      console.error(err.message ?? err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
