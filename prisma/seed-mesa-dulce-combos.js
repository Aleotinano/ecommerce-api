// Seed puntual: crea los 4 combos de Mesa Dulce (tenant "mesa-dulce") en la
// categoría "Combos" existente, con su whitelist de productos permitidos
// tomada del catálogo real de unidades ya cargado. Correr una sola vez, manual:
//   node prisma/seed-mesa-dulce-combos.js
import prisma from "../lib/prisma.js";
import { ProductModel } from "../services/productos.js";

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: "mesa-dulce" } });
  if (!tenant) throw new Error("Tenant 'mesa-dulce' no encontrado");

  const combosCategory = await prisma.categories.findFirst({
    where: { tenantId: tenant.id, name: "Combos" },
  });
  if (!combosCategory) throw new Error("Categoría 'Combos' no encontrada");

  const clasicas = await prisma.product.findMany({
    where: { tenantId: tenant.id, category: { name: "Cookies Clásicas" } },
    select: { id: true },
  });
  const rellenas = await prisma.product.findMany({
    where: { tenantId: tenant.id, category: { name: "Cookies Rellenas" } },
    select: { id: true },
  });
  const brownies = await prisma.product.findMany({
    where: { tenantId: tenant.id, category: { name: "Brownies" } },
    select: { id: true },
  });

  const toOptions = (products) => products.map((p) => ({ allowedProductId: p.id }));

  const combos = [
    {
      name: "Combo Entre Dos",
      price: 8500,
      comboMinItems: 6,
      comboMaxItems: 6,
      comboOptions: toOptions(clasicas),
    },
    {
      name: "Combo Mesa Dulce",
      price: 11000,
      comboMinItems: 8,
      comboMaxItems: 10,
      comboOptions: toOptions([...clasicas, ...rellenas]),
    },
    {
      name: "Rellenas y Clásicas",
      price: 19000,
      comboMinItems: 12,
      comboMaxItems: 12,
      comboOptions: toOptions([...clasicas, ...rellenas]),
    },
    {
      name: "Combo Familiar",
      price: 18000,
      comboMinItems: 16,
      comboMaxItems: 18,
      comboOptions: toOptions([...clasicas, ...rellenas, ...brownies]),
    },
  ];

  for (const combo of combos) {
    const existing = await prisma.product.findFirst({
      where: { tenantId: tenant.id, name: combo.name },
    });
    if (existing) {
      console.log(`  -> "${combo.name}" ya existe (id ${existing.id}), se omite`);
      continue;
    }

    const created = await ProductModel.create({
      tenantId: tenant.id,
      name: combo.name,
      categoryId: combosCategory.id,
      price: combo.price,
      variants: [],
      stock: 999,
      isCombo: true,
      comboMinItems: combo.comboMinItems,
      comboMaxItems: combo.comboMaxItems,
      comboOptions: combo.comboOptions,
    });
    console.log(`  -> "${combo.name}" creado (id ${created.id}), $${combo.price}`);
  }

  console.log("Seed de combos completo.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
