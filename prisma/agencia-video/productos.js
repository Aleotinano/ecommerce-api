// Servicios de agencia-video, tomados de ./servicios.json.
// Idempotente por SKU: correrlo de nuevo no duplica nada, y actualiza lo que cambió
// (nombre, descripción, categoría, precio, nombre del plan).
//   node prisma/agencia-video/productos.js
//
// Requiere que las categorías y el atributo `plan` ya existan (./categorias.js,
// ./atributos.js).
//
// Cada servicio es un `type: PRODUCTO` y cada plan una variante con
// `attributes: {"plan": "..."}`. El precio vive en la variante — en un PRODUCTO
// nunca en `Product.price`, que queda en null. La variante `isDefault` es el
// primer plan del JSON, que es el de entrada (el "desde $X" de la landing).
//
// STOCK: 0, y no se vuelve a tocar. El tenant está en modo carta (`storeMode:
// MENU`): no nacen órdenes desde la tienda, así que el stock no gobierna nada, y
// `showOutOfStock: true` (./config.js) hace que igual se vea todo. Es el criterio
// de docs/servicios/Tenants/new-tenant-config.md §6 para una carta: un número
// inventado se leería como real. Si el tenant pasa a vender online (perfil
// `produccion-por-sena`), el stock se decide en ese momento, no acá.
import "dotenv/config";
import { pathToFileURL } from "node:url";

import prisma from "../../lib/prisma.js";
import { closeRedis } from "../../lib/redis.js";
import { invalidateProductsCache } from "../../services/productos.js";
import { avisarSiPreciosDeReferencia, loadCatalogo, requireTenant } from "./categorias.js";

const STOCK_INICIAL = 0;

async function categoryIdByName(tenantId, name) {
  const category = await prisma.categories.findFirst({ where: { tenantId, name } });
  if (!category) {
    throw new Error(
      `Categoría "${name}" no encontrada para agencia-video — corré antes "pnpm seed:agencia-video:categorias".`
    );
  }
  return category.id;
}

const mismosAtributos = (a, b) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

const variantesDe = (servicio) =>
  servicio.planes.map((plan, index) => ({
    sku: plan.sku,
    attributes: { plan: plan.plan },
    price: plan.price,
    isDefault: index === 0,
  }));

async function ensureServicio({ tenantId, spec, categoryId, stats }) {
  const variants = variantesDe(spec);
  // La identidad del servicio es el SKU de su primer plan: sobrevive a un renombre.
  const principal = variants[0];
  const existente = await prisma.productVariant.findUnique({
    where: { tenantId_sku: { tenantId, sku: principal.sku } },
    include: { product: { include: { variants: true } } },
  });

  if (!existente) {
    await prisma.product.create({
      data: {
        tenantId,
        name: spec.name,
        description: spec.description ?? null,
        type: "PRODUCTO",
        price: null,
        categoryId,
        isActive: true,
        variants: {
          create: variants.map((variant) => ({
            tenantId,
            attributes: variant.attributes,
            price: variant.price,
            stock: STOCK_INICIAL,
            sku: variant.sku,
            isActive: true,
            isDefault: variant.isDefault,
          })),
        },
      },
    });
    stats.creados += 1;
    stats.variantesCreadas += variants.length;
    const detalle =
      variants.length > 1 ? ` (${variants.length} planes, desde $${principal.price})` : ` $${principal.price}`;
    console.log(`  -> "${spec.name}" creado${detalle}`);
    return;
  }

  const product = existente.product;

  const productoCambio =
    product.name !== spec.name ||
    product.description !== (spec.description ?? null) ||
    product.categoryId !== categoryId;

  if (productoCambio) {
    await prisma.product.update({
      where: { id: product.id },
      data: { name: spec.name, description: spec.description ?? null, categoryId },
    });
    stats.actualizados += 1;
    console.log(`  -> "${spec.name}" actualizado (nombre/descripción/categoría)`);
  }

  const porSku = new Map(product.variants.map((v) => [v.sku, v]));
  let hayDefault = product.variants.some((v) => v.isDefault);

  for (const variant of variants) {
    const actual = porSku.get(variant.sku);

    if (!actual) {
      // Plan que se sumó después. `isDefault` solo si el servicio no tiene ninguno
      // todavía: el índice único parcial admite uno solo.
      await prisma.productVariant.create({
        data: {
          tenantId,
          productId: product.id,
          attributes: variant.attributes,
          price: variant.price,
          stock: STOCK_INICIAL,
          sku: variant.sku,
          isActive: true,
          isDefault: !hayDefault,
        },
      });
      hayDefault = true;
      stats.variantesCreadas += 1;
      console.log(`  -> "${spec.name}": plan "${variant.attributes.plan}" agregado ($${variant.price})`);
      continue;
    }

    const cambios = {};
    if (actual.price !== variant.price) cambios.price = variant.price;
    if (!mismosAtributos(actual.attributes, variant.attributes)) cambios.attributes = variant.attributes;
    // El stock NO entra acá a propósito (ver el encabezado).

    if (Object.keys(cambios).length) {
      await prisma.productVariant.update({ where: { id: actual.id }, data: cambios });
      stats.variantesActualizadas += 1;
      if (cambios.price !== undefined) {
        console.log(`  -> "${spec.name}" (${variant.sku}): $${actual.price} -> $${variant.price}`);
      }
    }
  }

  // Planes que están en la base y ya no en el JSON: se avisan y no se tocan.
  // Desactivarlos es una decisión de negocio, no algo que un seed deba hacer solo.
  const enCatalogo = new Set(variants.map((v) => v.sku));
  for (const variant of product.variants) {
    if (!enCatalogo.has(variant.sku)) {
      stats.huerfanas.push(`${spec.name} / ${variant.sku}`);
    }
  }
}

export async function seedAgenciaVideoProductos() {
  const tenant = await requireTenant();
  const catalogo = loadCatalogo();
  const { servicios } = catalogo;

  console.log("== Servicios de agencia-video ==");
  avisarSiPreciosDeReferencia(catalogo);

  const stats = {
    creados: 0,
    actualizados: 0,
    variantesCreadas: 0,
    variantesActualizadas: 0,
    huerfanas: [],
  };

  const idByCategory = new Map();

  for (const spec of servicios) {
    if (!idByCategory.has(spec.category)) {
      idByCategory.set(spec.category, await categoryIdByName(tenant.id, spec.category));
    }
    await ensureServicio({
      tenantId: tenant.id,
      spec,
      categoryId: idByCategory.get(spec.category),
      stats,
    });
  }

  await invalidateProductsCache(tenant.id);

  const planes = servicios.reduce((sum, s) => sum + s.planes.length, 0);
  const sinCambios = servicios.length - stats.creados - stats.actualizados;
  console.log(
    `  ${stats.creados} servicios creados, ${stats.actualizados} actualizados, ${sinCambios} ya al día (${servicios.length} en el catálogo)`
  );
  console.log(
    `  ${stats.variantesCreadas} planes creados, ${stats.variantesActualizadas} actualizados (${planes} en el catálogo)`
  );
  if (stats.huerfanas.length) {
    console.log(
      `  ⚠️  ${stats.huerfanas.length} planes en la base que ya no están en servicios.json: ${stats.huerfanas.join(", ")}`
    );
  }

  return stats;
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  seedAgenciaVideoProductos()
    .then(() => console.log("Listo: servicios de agencia-video sincronizados."))
    .catch((err) => {
      console.error(err.message ?? err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeRedis();
      await prisma.$disconnect();
    });
}
