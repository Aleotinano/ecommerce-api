// Script puntual (una sola vez, manual):
//   node prisma/fix-mesa-dulce-categories-and-combos.js
//
// Para el tenant "mesa-dulce":
//  1. Reordena las 3 categorías existentes (Brownies, Cookies Clásicas, Cookies
//     Rellenas) al orden: Clásicas, Brownies, Rellenas.
//  2. Crea (si no existen) las categorías "Combos" y "Combo Mundialista", vacías.
//  3. Crea (si no existen, por nombre) los 3 combos reales de mesa-dulce con
//     ComboAllowedCategory ("N fijo de la familia X"), reemplazando el script viejo
//     seed-mesa-dulce-combos.js (reglas incorrectas / 4to combo no deseado).
//
// Idempotente: correrlo de nuevo no duplica nada ni pisa lo ya creado.
import prisma from "../lib/prisma.js";
import { CategoryModel } from "../services/categories.js";
import { ProductModel } from "../services/productos.js";
import { closeRedis } from "../lib/redis.js";

async function findCategoryByName(tenantId, name) {
  const category = await prisma.categories.findFirst({ where: { tenantId, name } });
  if (!category) {
    throw new Error(`Categoría "${name}" no encontrada para tenant ${tenantId}`);
  }
  return category;
}

async function ensureCategory({ tenantId, name, position }) {
  const existing = await prisma.categories.findFirst({ where: { tenantId, name } });
  if (existing) {
    console.log(`  -> categoría "${name}" ya existe (id ${existing.id}), se omite creación`);
    return existing;
  }
  const created = await CategoryModel.create({ tenantId, name, position });
  console.log(`  -> categoría "${name}" creada (id ${created.id}, position ${position})`);
  return created;
}

async function setCategoryPosition({ tenantId, category, position }) {
  if (category.position === position) {
    console.log(`  -> "${category.name}" ya tiene position ${position}, se omite`);
    return category;
  }
  const updated = await CategoryModel.edit({ tenantId, id: category.id, position });
  console.log(`  -> "${category.name}" (id ${category.id}) position ${category.position} -> ${position}`);
  return updated;
}

async function ensureCombo({ tenantId, name, categoryId, price, comboCategoryOptions }) {
  const existing = await prisma.product.findFirst({ where: { tenantId, name } });
  if (existing) {
    console.log(`  -> combo "${name}" ya existe (id ${existing.id}), se omite`);
    return existing;
  }

  const created = await ProductModel.create({
    tenantId,
    name,
    categoryId,
    price,
    type: "COMBO",
    comboCategoryOptions,
  });
  console.log(`  -> combo "${name}" creado (id ${created.id}), $${price}`);
  return created;
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: "mesa-dulce" } });
  if (!tenant) throw new Error("Tenant 'mesa-dulce' no encontrado");
  const tenantId = tenant.id;

  console.log("== 1. Reordenando categorías existentes ==");
  const brownies = await findCategoryByName(tenantId, "Brownies");
  const clasicas = await findCategoryByName(tenantId, "Cookies Clásicas");
  const rellenas = await findCategoryByName(tenantId, "Cookies Rellenas");

  await setCategoryPosition({ tenantId, category: clasicas, position: 0 });
  await setCategoryPosition({ tenantId, category: brownies, position: 1 });
  await setCategoryPosition({ tenantId, category: rellenas, position: 2 });

  console.log("== 2. Creando categorías nuevas (vacías) ==");
  const combosCategory = await ensureCategory({ tenantId, name: "Combos", position: 3 });
  await ensureCategory({ tenantId, name: "Combo Mundialista", position: 4 });

  console.log("== 3. Creando combos reales ==");
  const combos = [
    {
      name: "Combo Mesa Dulce",
      price: 11000,
      comboCategoryOptions: [
        { categoryId: brownies.id, minQty: 4, maxQty: 4 },
        { categoryId: clasicas.id, minQty: 6, maxQty: 6 },
      ],
    },
    {
      name: "Combo Familiar",
      price: 18000,
      comboCategoryOptions: [
        { categoryId: brownies.id, minQty: 6, maxQty: 6 },
        { categoryId: clasicas.id, minQty: 12, maxQty: 12 },
      ],
    },
    {
      name: "Combo Entre Dos",
      price: 8500,
      comboCategoryOptions: [
        { categoryId: rellenas.id, minQty: 1, maxQty: 1 },
        { categoryId: brownies.id, minQty: 1, maxQty: 1 },
        { categoryId: clasicas.id, minQty: 4, maxQty: 4 },
      ],
    },
  ];

  for (const combo of combos) {
    await ensureCombo({
      tenantId,
      name: combo.name,
      categoryId: combosCategory.id,
      price: combo.price,
      comboCategoryOptions: combo.comboCategoryOptions,
    });
  }

  console.log("Listo: categorías reordenadas/creadas y combos verificados.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    // CategoryModel.create/edit invalidan cache vía Redis (lib/cache.js) — esa
    // conexión queda abierta y evita que el proceso salga solo si no se cierra.
    await closeRedis();
    await prisma.$disconnect();
  });
