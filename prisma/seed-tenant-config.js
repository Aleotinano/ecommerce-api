import "dotenv/config";
import { pathToFileURL } from "node:url";

import prisma from "../lib/prisma.js";
import {
  DEFAULT_TENANT_PROFILE,
  resolveProfile,
} from "../services/tenant-profiles.js";

export const tenantConfigSeeds = {
  acme: {
    storeName: "Acme Store",
    storeDescription:
      "Indumentaria casual y básicos atemporales. Calidad sin vueltas.",
    storeTagline: "Vestí lo esencial",
    contactEmail: "hola@acme.com",
    contactPhone: "+54 11 5555-1234",
    contactAddress: "Av. Corrientes 1234, CABA, Argentina",
    socialInstagram: "https://instagram.com/acme.store",
    socialTiktok: "https://tiktok.com/@acme.store",
    socialFacebook: "https://facebook.com/acmestore",
    socialTwitter: "https://twitter.com/acmestore",
    socialYoutube: "https://youtube.com/@acmestore",
    socialPinterest: "https://pinterest.com/acmestore",
    socialWhatsapp: "+5491155551234",
    seoTitle: "Acme Store — Remeras y pantalones",
    seoDescription:
      "Indumentaria casual: remeras de algodón, jeans clásicos y más. Envíos a todo el país.",
    seoKeywords: "remeras, jeans, indumentaria, ropa casual, Argentina",
    shippingPolicy:
      "Envíos por correo a todo el país. 3-7 días hábiles. Gratis a partir de $30.000.",
    returnsPolicy:
      "Cambios y devoluciones hasta 15 días después de la compra, con producto sin uso y etiqueta.",
    privacyPolicy:
      "Usamos tus datos sólo para procesar tu pedido. No los compartimos con terceros.",
    currency: "ARS",
    locale: "es-AR",
    showOutOfStock: false,
    allowCartGuest: true,
  },
  shopco: {
    storeName: "ShopCo",
    storeDescription:
      "Electrónica y gadgets: auriculares, parlantes, accesorios y más.",
    storeTagline: "Tu tienda de tecnología",
    contactEmail: "contacto@shopco.com",
    contactPhone: "+54 11 4444-5678",
    contactAddress: "Av. Santa Fe 4321, CABA, Argentina",
    socialInstagram: "https://instagram.com/shopco",
    socialTiktok: "https://tiktok.com/@shopco",
    socialFacebook: "https://facebook.com/shopco",
    socialWhatsapp: "+5491144445678",
    seoTitle: "ShopCo — Electrónica y gadgets",
    seoDescription:
      "Auriculares bluetooth, parlantes y accesorios al mejor precio. Envíos en 48hs.",
    seoKeywords: "auriculares, bluetooth, electrónica, gadgets, tecnología",
    shippingPolicy:
      "Envíos OCA a todo el país. 2-5 días hábiles. Retiro en sucursal disponible.",
    returnsPolicy:
      "10 días para devoluciones por arrepentimiento. Producto debe estar en su packaging original.",
    privacyPolicy:
      "Cumplimos con la Ley 25.326 de Protección de Datos Personales.",
    currency: "ARS",
    locale: "es-AR",
    showOutOfStock: true,
    allowCartGuest: false,
  },
  // Sin branding todavía (el catálogo real se carga aparte, ver seed.js).
  // Mesa Dulce cobra el total de una: no trabaja con seña, y el reembolso de una
  // orden cancelada lo hace el admin por fuera del sistema. Eso es exactamente el
  // perfil `estandar`, así que no declara nada de flujo — no hace falta un perfil
  // a medida para el primer cliente.
  "mesa-dulce": {},
};

/**
 * Perfil de flujo de venta por tenant sembrado. Los tres van con `estandar` (todo
 * habilitado, sin seña), que es lo que estos tenants hacían antes de que los
 * perfiles existieran. Se declara igual, y no se deja implícito, para que agregar
 * un tenant de demo con otro flujo sea cambiar una línea.
 *
 * Vive separado de `tenantConfigSeeds` porque no es branding: son los campos que
 * el tenant NO edita (ver READONLY_TENANT_CONFIG_FIELDS).
 */
export const tenantProfileSeeds = {
  acme: "estandar",
  shopco: "estandar",
  "mesa-dulce": "estandar",
};

export async function seedTenantConfigs() {
  for (const [slug, data] of Object.entries(tenantConfigSeeds)) {
    const tenant = await prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, name: true },
    });

    if (!tenant) {
      console.warn(`⚠️  Tenant "${slug}" no existe. Salteando config.`);
      continue;
    }

    // El perfil primero y el branding después: si algún día un seed quisiera
    // pisar un campo de flujo a mano, gana el seed y se ve en el diff.
    const profileName = tenantProfileSeeds[slug] ?? DEFAULT_TENANT_PROFILE;
    const values = { ...resolveProfile(profileName), ...data };

    const config = await prisma.tenantConfig.upsert({
      where: { tenantId: tenant.id },
      update: values,
      create: { tenantId: tenant.id, ...values },
      select: { id: true, storeName: true },
    });

    console.log(
      `✓ ${tenant.name} (slug: ${slug}, tenantId: ${tenant.id}) → config #${config.id} "${config.storeName}" [perfil: ${profileName}]`
    );
  }
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  seedTenantConfigs()
    .then(() => console.log("\n=== Seed de tenant-config completado ==="))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
