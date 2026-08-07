// Branding y contacto de Maikai sobre la TenantConfig que ya creó el alta.
// Idempotente: es un update de campos concretos.
//   node prisma/maikai/config.js
//
// NO toca el bloque de flujo de venta (storeMode, métodos de pago/entrega, seña):
// eso sale del perfil `carta` que se aplica al crear el tenant, y se corrige con
// `node prisma/set-tenant-profile.js maikai carta`. Ver [[Perfiles de flujo de venta]].
import "dotenv/config";
import { pathToFileURL } from "node:url";

import prisma from "../../lib/prisma.js";
import { requireTenant } from "./categorias.js";

// El horario (9:00 a 3:00, de corrido) va embebido en la descripción: TenantConfig
// no tiene campo de horarios de atención. Cuando la landing le dé un lugar propio,
// se mueve ahí.
const CONFIG = {
  storeName: "Maikai",
  storeTagline: "Café, Bar, Restó & Grow",
  storeDescription:
    "Cafetería, bar y restó en pleno centro de San Juan. Pastas al paso al mediodía. Abrimos de corrido de 9:00 a 3:00.",

  contactPhone: "+54 264 520 2525",
  contactAddress: "Av. Ignacio de la Rosa 545 (O), San Juan, Argentina",
  // Con el 9 de móvil: wa.me lo exige para los celulares argentinos. El
  // normalizador del storefront (`whatsappHref`) respeta tal cual cualquier
  // número que ya empiece con 54, así que un "+542645202525" acá arma un link
  // que abre WhatsApp con un contacto inexistente.
  socialWhatsapp: "5492645202525",
  // socialInstagram queda sin cargar: el handle se ve truncado en la captura que
  // pasó el cliente (maikai.cafegrow…) y no se inventa. Falta confirmarlo.

  seoTitle: "Maikai — Café, Bar, Restó & Grow en San Juan",
  seoDescription:
    "Pastas al paso, ciabattas, brunch, café de especialidad y coctelería. Av. Ignacio de la Rosa 545 (O), San Juan. Abierto de 9:00 a 3:00, de corrido.",
  seoKeywords:
    "maikai, café san juan, pastas al paso, brunch san juan, ciabattas, coctelería, restó",

  currency: "ARS",
  locale: "es-AR",
  customerPhoneCountry: "54",
  customerPhoneArea: "264",

  // El catálogo entero va con stock 0 (ver ./productos.js): sin esto, la carta se
  // vería vacía.
  showOutOfStock: true,
  // Nada del menú tiene ejes de elección (talle, color, sabor): oculta "Agregar
  // variante" en el panel.
  productVariantsEnabled: false,
};

export async function seedMaikaiConfig() {
  const tenant = await requireTenant();

  console.log("== TenantConfig de maikai ==");

  const config = await prisma.tenantConfig.upsert({
    where: { tenantId: tenant.id },
    update: CONFIG,
    create: { tenantId: tenant.id, ...CONFIG },
    select: { id: true, storeName: true, storeMode: true, showOutOfStock: true },
  });

  console.log(`  config #${config.id} "${config.storeName}" — modo ${config.storeMode}, showOutOfStock ${config.showOutOfStock}`);

  if (config.storeMode !== "MENU") {
    console.warn(
      `  ⚠️  storeMode es "${config.storeMode}", no "MENU". Maikai es una carta:\n` +
        "      node prisma/set-tenant-profile.js maikai carta"
    );
  }

  return config;
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  seedMaikaiConfig()
    .then(() => console.log("Listo: config de maikai aplicada."))
    .catch((err) => {
      console.error(err.message ?? err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
