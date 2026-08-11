// Combos (las promos de la carta) de Punto Healthy, desde ./catalogo.json.
// Idempotente por nombre: correrlo de nuevo no duplica combos, actualiza precio,
// precio de lista y descripción, y re-arma la whitelist solo si no coincide con la
// carta.
//   node prisma/punto-healthy/combos.js
//
// Requiere que las categorías y los productos ya existan (./categorias.js,
// ./productos.js): la whitelist de un combo referencia productos por id.
//
// Va por `ProductModel` y no por Prisma directo —a diferencia de ./productos.js— para
// que las reglas queden armadas exactamente igual que si las hubiera cargado alguien
// desde el panel: el service es el que deriva `comboMinItems`/`comboMaxItems` de las
// reglas de categoría y el que valida que no haya combos anidados.
//
// Cuál de los dos patrones de whitelist usa cada combo lo decide `planCombo` en
// ./build-menu.js (ahí está el porqué); acá solo se ejecuta lo que salió de ahí.
import "dotenv/config";
import { pathToFileURL } from "node:url";

import prisma from "../../lib/prisma.js";
import { closeRedis } from "../../lib/redis.js";
import { ProductModel } from "../../services/productos.js";
import { loadCatalogo, requireTenant } from "./categorias.js";

async function categoryIdByName(tenantId, name) {
  const category = await prisma.categories.findFirst({ where: { tenantId, name } });
  if (!category) {
    throw new Error(
      `Categoría "${name}" no encontrada para punto-healthy — corré antes "pnpm seed:punto-healthy:categorias".`
    );
  }
  return category.id;
}

async function productIdByName(tenantId, name) {
  const product = await prisma.product.findFirst({
    where: { tenantId, name, type: "PRODUCTO" },
    select: { id: true },
  });
  if (!product) {
    throw new Error(
      `Producto "${name}" no encontrado para punto-healthy — ¿corrió "pnpm seed:punto-healthy:productos" antes que los combos?`
    );
  }
  return product.id;
}

/** Traduce el plan del catálogo (nombres) a lo que espera `ProductModel` (ids). */
async function resolverWhitelist(tenantId, spec) {
  if (spec.patron === "categorias") {
    const comboCategoryOptions = await Promise.all(
      spec.categoryOptions.map(async (option) => ({
        categoryId: await categoryIdByName(tenantId, option.category),
        minQty: option.minQty,
        maxQty: option.maxQty,
        // Vacío = toda la categoría; con miembros = lista cerrada.
        productIds: await Promise.all(option.products.map((name) => productIdByName(tenantId, name))),
      }))
    );
    return { comboOptions: [], comboCategoryOptions };
  }

  const comboOptions = await Promise.all(
    spec.options.map(async (option) => ({
      allowedProductId: await productIdByName(tenantId, option.product),
      minQty: option.minQty,
      maxQty: option.maxQty,
    }))
  );
  return { comboOptions, comboCategoryOptions: [] };
}

/**
 * Huella de la whitelist para comparar lo que hay en la base contra la carta, sin
 * reescribirla en cada corrida (reemplazarla es delete+create de todas las filas).
 */
function huella({ comboOptions, comboCategoryOptions }) {
  const standalone = comboOptions
    .map((o) => `p${o.allowedProductId}:${o.minQty}:${o.maxQty ?? ""}`)
    .sort();
  const categorias = comboCategoryOptions
    .map((o) => `c${o.categoryId}:${o.minQty}:${o.maxQty ?? ""}:[${[...o.productIds].sort((a, b) => a - b).join(",")}]`)
    .sort();
  return JSON.stringify({ standalone, categorias });
}

function huellaActual(product) {
  const standalone = product.comboOptions
    .filter((o) => o.comboAllowedCategoryId == null)
    .map((o) => `p${o.allowedProductId}:${o.minQty}:${o.maxQty ?? ""}`)
    .sort();
  const categorias = product.comboCategoryOptions
    .map((o) => {
      const members = product.comboOptions
        .filter((m) => m.comboAllowedCategoryId === o.id)
        .map((m) => m.allowedProductId)
        .sort((a, b) => a - b);
      return `c${o.categoryId}:${o.minQty}:${o.maxQty ?? ""}:[${members.join(",")}]`;
    })
    .sort();
  return JSON.stringify({ standalone, categorias });
}

async function ensureCombo({ tenantId, spec, categoryId, stats }) {
  const whitelist = await resolverWhitelist(tenantId, spec);
  const existing = await prisma.product.findFirst({
    where: { tenantId, name: spec.name },
    include: {
      comboOptions: { where: { isActive: true } },
      comboCategoryOptions: { where: { isActive: true } },
    },
  });

  if (!existing) {
    const created = await ProductModel.create({
      tenantId,
      name: spec.name,
      description: spec.description,
      categoryId,
      price: spec.price,
      compareAtPrice: spec.compareAtPrice,
      type: "COMBO",
      comboMinItems: spec.comboMinItems,
      comboMaxItems: spec.comboMaxItems,
      ...whitelist,
    });
    stats.creados += 1;
    const ahorro = spec.savings != null ? `, ahorro $${spec.savings}` : "";
    console.log(`  -> combo "${spec.name}" creado (id ${created.id}) $${spec.price}${ahorro} — ${spec.patron}`);
    return created;
  }

  const datosCambiaron =
    existing.description !== (spec.description ?? null) ||
    existing.price !== spec.price ||
    existing.compareAtPrice !== spec.compareAtPrice ||
    existing.categoryId !== categoryId ||
    existing.comboMinItems !== spec.comboMinItems ||
    existing.comboMaxItems !== spec.comboMaxItems;
  const whitelistCambio = huellaActual(existing) !== huella(whitelist);

  if (!datosCambiaron && !whitelistCambio) return existing;

  const updated = await ProductModel.edit(
    { tenantId, id: existing.id },
    {
      description: spec.description,
      categoryId,
      price: spec.price,
      compareAtPrice: spec.compareAtPrice,
      type: "COMBO",
      comboMinItems: spec.comboMinItems,
      comboMaxItems: spec.comboMaxItems,
      // Se mandan siempre las dos: la que no corresponde al patrón va vacía, así un
      // combo que cambió de patrón no se queda con las reglas viejas del otro.
      ...whitelist,
    }
  );
  stats.actualizados += 1;
  const detalle = [datosCambiaron && "datos", whitelistCambio && "whitelist"].filter(Boolean).join(" + ");
  console.log(`  -> combo "${spec.name}" (id ${existing.id}) actualizado (${detalle})`);
  return updated;
}

export async function seedPuntoHealthyCombos() {
  const tenant = await requireTenant();
  const { combos } = loadCatalogo();

  console.log("== Combos de punto-healthy ==");

  const stats = { creados: 0, actualizados: 0 };
  const idByCategory = new Map();

  for (const spec of combos) {
    if (!idByCategory.has(spec.category)) {
      idByCategory.set(spec.category, await categoryIdByName(tenant.id, spec.category));
    }
    await ensureCombo({
      tenantId: tenant.id,
      spec,
      categoryId: idByCategory.get(spec.category),
      stats,
    });
  }

  const sinCambios = combos.length - stats.creados - stats.actualizados;
  console.log(
    `  ${stats.creados} creados, ${stats.actualizados} actualizados, ${sinCambios} ya al día (${combos.length} promos en la carta)`
  );
  return stats;
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  seedPuntoHealthyCombos()
    .then(() => console.log("Listo: combos de punto-healthy sincronizados."))
    .catch((err) => {
      console.error(err.message ?? err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeRedis();
      await prisma.$disconnect();
    });
}
