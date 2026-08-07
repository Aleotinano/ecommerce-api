// Productos del menú de Maikai, tomados de ./menu.json (ver ./build-menu.js).
// Idempotente por SKU: correrlo de nuevo no duplica nada, y actualiza los que
// cambiaron (nombre, descripción, categoría, precio).
//   node prisma/maikai/productos.js
//
// Requiere que las categorías ya existan (ver ./categorias.js).
//
// Todos son `type: PRODUCTO`: el menú no tiene combos armables ni ejes de
// elección, así que cada uno lleva UNA variante default con el precio. En un
// PRODUCTO el precio vive en la variante (`isDefault`), nunca en `Product.price`.
//
// `stock: 0` a propósito. Maikai corre en modo MENU (perfil `carta`): no nacen
// órdenes, así que el stock no gobierna nada, y no se inventa un número que
// después alguien lea como real. Para que la carta se vea completa igual, el
// tenant va con `showOutOfStock: true` (ver ./config.js).
import "dotenv/config";
import { pathToFileURL } from "node:url";

import prisma from "../../lib/prisma.js";
import { closeRedis } from "../../lib/redis.js";
import { invalidateProductsCache } from "../../services/productos.js";
import { loadMenu, requireTenant } from "./categorias.js";

const STOCK = 0;

async function categoryIdByName(tenantId, name) {
  const category = await prisma.categories.findFirst({ where: { tenantId, name } });
  if (!category) {
    throw new Error(
      `Categoría "${name}" no encontrada para maikai — corré antes "pnpm seed:maikai:categorias".`
    );
  }
  return category.id;
}

async function ensureProduct({ tenantId, spec, categoryId }) {
  const existingVariant = await prisma.productVariant.findUnique({
    where: { tenantId_sku: { tenantId, sku: spec.sku } },
    include: { product: true },
  });

  if (!existingVariant) {
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
          create: [
            {
              tenantId,
              attributes: {},
              price: spec.price,
              stock: STOCK,
              sku: spec.sku,
              isActive: true,
              isDefault: true,
            },
          ],
        },
      },
    });
    return { created: true, updated: false, product: created };
  }

  const product = existingVariant.product;

  const productChanged =
    product.name !== spec.name ||
    product.description !== (spec.description ?? null) ||
    product.categoryId !== categoryId;
  const priceChanged = existingVariant.price !== spec.price;

  if (!productChanged && !priceChanged) {
    return { created: false, updated: false, product };
  }

  if (productChanged) {
    await prisma.product.update({
      where: { id: product.id },
      data: {
        name: spec.name,
        description: spec.description ?? null,
        categoryId,
      },
    });
  }

  if (priceChanged) {
    await prisma.productVariant.update({
      where: { id: existingVariant.id },
      data: { price: spec.price },
    });
    console.log(`  -> "${spec.name}" (${spec.sku}): $${existingVariant.price} -> $${spec.price}`);
  }

  return { created: false, updated: true, product };
}

export async function seedMaikaiProductos() {
  const tenant = await requireTenant();
  const { products } = loadMenu();

  console.log("== Productos de maikai ==");

  // El id de categoría se resuelve una vez por categoría, no una por producto:
  // son 251 productos sobre 24 categorías.
  const idByCategory = new Map();
  let created = 0;
  let updated = 0;

  for (const spec of products) {
    if (!idByCategory.has(spec.category)) {
      idByCategory.set(spec.category, await categoryIdByName(tenant.id, spec.category));
    }

    const result = await ensureProduct({
      tenantId: tenant.id,
      spec,
      categoryId: idByCategory.get(spec.category),
    });

    if (result.created) created += 1;
    if (result.updated) updated += 1;
  }

  await invalidateProductsCache(tenant.id);

  const skipped = products.length - created - updated;
  console.log(`  ${created} creados, ${updated} actualizados, ${skipped} ya al día (${products.length} en el menú)`);

  return { created, updated, total: products.length };
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  seedMaikaiProductos()
    .then(() => console.log("Listo: productos de maikai sincronizados."))
    .catch((err) => {
      console.error(err.message ?? err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeRedis();
      await prisma.$disconnect();
    });
}
