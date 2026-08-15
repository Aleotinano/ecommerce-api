// Productos de Pastaia, tomados de ./catalogo.json (ver ./build-menu.js).
// Idempotente por SKU: correrlo de nuevo no duplica nada, y actualiza lo que cambió
// (nombre, descripción, categoría, precio, atributos de la variante).
//   node prisma/pastaia/productos.js
//
// Requiere que las categorías y los atributos ya existan (./categorias.js,
// ./atributos.js). No hay combos en este tenant.
//
// Todos son `type: PRODUCTO`. Las 12 pastas llevan 9 variantes cada una (masa x caja,
// con `attributes` {"masa": "Remolacha", "caja": "24 unidades"}); las 3 salsas llevan
// UNA variante sin atributos. En los dos casos el precio vive en la variante — en un
// PRODUCTO nunca en `Product.price`, que queda en null.
//
// STOCK: se escribe SOLO al crear la variante (999, ver build-menu.js) y nunca se
// vuelve a tocar. Pastaia vende (modo SHOP): si el seed lo re-escribiera en cada
// corrida, borraría el stock real que el negocio venga manejando desde el panel.
import "dotenv/config";
import { pathToFileURL } from "node:url";

import prisma from "../../lib/prisma.js";
import { closeRedis } from "../../lib/redis.js";
import { invalidateProductsCache } from "../../services/productos.js";
import { loadCatalogo, requireTenant } from "./categorias.js";

async function categoryIdByName(tenantId, name) {
  const category = await prisma.categories.findFirst({ where: { tenantId, name } });
  if (!category) {
    throw new Error(
      `Categoría "${name}" no encontrada para pastaia — corré antes "pnpm seed:pastaia:categorias".`
    );
  }
  return category.id;
}

const mismosAtributos = (a, b) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

async function ensureProduct({ tenantId, spec, categoryId, stats }) {
  // La identidad del producto es el SKU de su variante principal: sobrevive a un
  // renombre, que es justo lo que un seed idempotente tiene que poder actualizar.
  const principal = spec.variants.find((v) => v.isDefault) ?? spec.variants[0];
  const existente = await prisma.productVariant.findUnique({
    where: { tenantId_sku: { tenantId, sku: principal.sku } },
    include: { product: { include: { variants: true } } },
  });

  if (!existente) {
    const created = await prisma.product.create({
      data: {
        tenantId,
        name: spec.name,
        description: spec.description ?? null,
        type: "PRODUCTO",
        price: null,
        categoryId,
        isActive: true,
        variants: {
          create: spec.variants.map((variant) => ({
            tenantId,
            attributes: variant.attributes,
            price: variant.price,
            stock: variant.stock,
            sku: variant.sku,
            isActive: true,
            isDefault: variant.isDefault,
          })),
        },
      },
    });
    stats.creados += 1;
    stats.variantesCreadas += spec.variants.length;
    const detalle =
      spec.variants.length > 1 ? ` (${spec.variants.length} variantes, desde $${principal.price})` : ` $${principal.price}`;
    console.log(`  -> "${spec.name}" creado${detalle}`);
    return created;
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

  for (const variant of spec.variants) {
    const actual = porSku.get(variant.sku);

    if (!actual) {
      // Masa o tamaño de caja que se sumó después. `isDefault` solo si el producto no
      // tiene ninguna todavía: el índice único parcial admite una sola.
      await prisma.productVariant.create({
        data: {
          tenantId,
          productId: product.id,
          attributes: variant.attributes,
          price: variant.price,
          stock: variant.stock,
          sku: variant.sku,
          isActive: true,
          isDefault: !hayDefault,
        },
      });
      hayDefault = true;
      stats.variantesCreadas += 1;
      console.log(`  -> "${spec.name}": variante ${variant.sku} agregada ($${variant.price})`);
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

  // Variantes que están en la base y ya no en el catálogo: se avisan y no se tocan.
  // Borrarlas o desactivarlas es una decisión de negocio (puede haber órdenes viejas
  // apuntando ahí), no algo que un seed deba hacer solo.
  const enCatalogo = new Set(spec.variants.map((v) => v.sku));
  for (const variant of product.variants) {
    if (!enCatalogo.has(variant.sku)) {
      stats.huerfanas.push(`${spec.name} / ${variant.sku}`);
    }
  }

  return product;
}

export async function seedPastaiaProductos() {
  const tenant = await requireTenant();
  const { productos } = loadCatalogo();

  console.log("== Productos de pastaia ==");

  const stats = {
    creados: 0,
    actualizados: 0,
    variantesCreadas: 0,
    variantesActualizadas: 0,
    huerfanas: [],
  };

  // El id de categoría se resuelve una vez por categoría, no una por producto.
  const idByCategory = new Map();

  for (const spec of productos) {
    if (!idByCategory.has(spec.category)) {
      idByCategory.set(spec.category, await categoryIdByName(tenant.id, spec.category));
    }
    await ensureProduct({
      tenantId: tenant.id,
      spec,
      categoryId: idByCategory.get(spec.category),
      stats,
    });
  }

  await invalidateProductsCache(tenant.id);

  const variantes = productos.reduce((sum, p) => sum + p.variants.length, 0);
  const sinCambios = productos.length - stats.creados - stats.actualizados;
  console.log(
    `  ${stats.creados} productos creados, ${stats.actualizados} actualizados, ${sinCambios} ya al día (${productos.length} en el catálogo)`
  );
  console.log(
    `  ${stats.variantesCreadas} variantes creadas, ${stats.variantesActualizadas} actualizadas (${variantes} en el catálogo)`
  );
  if (stats.huerfanas.length) {
    console.log(
      `  ⚠️  ${stats.huerfanas.length} variantes en la base que ya no están en el catálogo: ${stats.huerfanas.join(", ")}`
    );
  }

  return stats;
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  seedPastaiaProductos()
    .then(() => console.log("Listo: productos de pastaia sincronizados."))
    .catch((err) => {
      console.error(err.message ?? err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeRedis();
      await prisma.$disconnect();
    });
}
