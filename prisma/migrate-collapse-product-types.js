// Backfill puntual (Fase 2 del colapso de Product.type UNIDAD/VARIANTE -> PRODUCTO):
// garantiza que todo producto no-combo tenga exactamente una ProductVariant "principal"
// (isDefault=true, isActive=true) con precio/stock reales, y cierra el trapdoor de
// `ProductVariant.price IS NULL` (hoy significa "hereda Product.price") — necesario
// porque tras la migración de contract `Product.price` deja de ser legible para
// PRODUCTO. NO toca `Product.type` (lo hace la migración de contract vía USING).
//
// Ramifica por `product.type`, no por cantidad de variantes, porque la migración
// original (`migrate-product-types.js`) dejó en los UNIDAD una variante "sintética"
// inactiva con datos placeholder (price:null, stock:0) mientras los valores reales
// viven en las columnas de Product — no son variantes reales utilizables, hay que
// reescribirlas con los valores reales en vez de tratarlas como una VARIANTE genuina:
//   - type UNIDAD: si ya tiene una variante (la sintética), la REUTILIZA (reactiva +
//     pisa price/stock con los valores reales de Product) en vez de crear una nueva —
//     evita filas duplicadas. Si no tiene ninguna, crea una.
//   - type VARIANTE: variantes reales, no se tocan price/stock — solo se promueve la de
//     menor id a isDefault y se backfillean los price NULL (herencia de Product.price).
//
// A diferencia de `backfill-default-variants.js` (reemplazado por este script), excluye
// explícitamente COMBO y copia valores reales en vez de placeholders invendibles.
//
// Idempotente. Correr una sola vez por entorno, entre la migración de expand y la de
// contract:
//   node prisma/migrate-collapse-product-types.js
import prisma from "../lib/prisma.js";
import { generateSku } from "../utils/sku.js";

async function uniqueSku(tenantId, productName, reservedSkus) {
  let sku;
  do {
    sku = generateSku({ productName });
  } while (
    reservedSkus.has(sku) ||
    (await prisma.productVariant.findUnique({
      where: { tenantId_sku: { tenantId, sku } },
      select: { id: true },
    }))
  );
  reservedSkus.add(sku);
  return sku;
}

async function main() {
  const products = await prisma.product.findMany({
    where: { type: { in: ["UNIDAD", "VARIANTE"] } },
    include: { variants: true },
  });

  console.log(`Productos UNIDAD/VARIANTE encontrados: ${products.length}`);

  const reservedSkus = new Set();
  let created = 0;
  let reused = 0;
  let promoted = 0;
  let priceBackfilled = 0;

  for (const product of products) {
    if (product.type === "UNIDAD") {
      const existing = [...product.variants].sort((a, b) => a.id - b.id)[0] ?? null;

      if (existing) {
        if (!existing.isDefault) {
          await prisma.productVariant.update({
            where: { id: existing.id },
            data: {
              isDefault: true,
              isActive: true,
              price: product.price,
              stock: product.stock ?? 0,
            },
          });
          reused += 1;
          console.log(
            `  -> variante ${existing.id} reutilizada como default en producto ${product.id} (${product.name})`
          );
        }
      } else {
        const sku = await uniqueSku(product.tenantId, product.name, reservedSkus);
        await prisma.productVariant.create({
          data: {
            tenantId: product.tenantId,
            productId: product.id,
            color: null,
            size: null,
            price: product.price,
            stock: product.stock ?? 0,
            sku,
            isActive: true,
            isDefault: true,
          },
        });
        created += 1;
        console.log(
          `  -> variante default creada para producto ${product.id} (${product.name}), sku ${sku}`
        );
      }
      continue;
    }

    // type === "VARIANTE": variantes reales, no se tocan price/stock.
    if (product.variants.length === 0) {
      // Defensivo: no debería pasar (schema exige >=1 variante para VARIANTE), pero si
      // pasa se trata igual que UNIDAD sin variante.
      const sku = await uniqueSku(product.tenantId, product.name, reservedSkus);
      await prisma.productVariant.create({
        data: {
          tenantId: product.tenantId,
          productId: product.id,
          color: null,
          size: null,
          price: product.price,
          stock: 0,
          sku,
          isActive: true,
          isDefault: true,
        },
      });
      created += 1;
      console.log(
        `  -> variante default creada (VARIANTE sin variantes, caso defensivo) para producto ${product.id} (${product.name}), sku ${sku}`
      );
      continue;
    }

    const alreadyHasDefault = product.variants.some((v) => v.isDefault);
    if (!alreadyHasDefault) {
      const first = [...product.variants].sort((a, b) => a.id - b.id)[0];
      await prisma.productVariant.update({
        where: { id: first.id },
        data: { isDefault: true },
      });
      promoted += 1;
      console.log(
        `  -> variante ${first.id} marcada default en producto ${product.id} (${product.name})`
      );
    }

    const nullPriceVariants = product.variants.filter((v) => v.price === null);
    for (const variant of nullPriceVariants) {
      await prisma.productVariant.update({
        where: { id: variant.id },
        data: { price: product.price },
      });
      priceBackfilled += 1;
      console.log(
        `  -> variante ${variant.id} (producto ${product.id}) price backfilleado a ${product.price}`
      );
    }
  }

  console.log(`Variantes default creadas: ${created}`);
  console.log(`Variantes sintéticas reutilizadas como default: ${reused}`);
  console.log(`Variantes promovidas a default (VARIANTE real): ${promoted}`);
  console.log(`Variantes con price NULL backfilleadas: ${priceBackfilled}`);

  // Limpieza: productos COMBO no tienen variante propia en el modelo nuevo (ni la
  // tenían en el viejo — la migración original `migrate-product-types.js` las dejaba
  // inactivas en vez de borrarlas). Con `ProductVariant.price` por pasar a NOT NULL en
  // la migración de contract, estas filas huérfanas (price NULL, isActive false, sin
  // referencias en CartItem/OrderItem porque ya fueron limpiadas en su momento) hay que
  // borrarlas.
  const comboOrphans = await prisma.productVariant.deleteMany({
    where: { product: { type: "COMBO" } },
  });
  console.log(`Variantes huérfanas de productos COMBO borradas: ${comboOrphans.count}`);

  console.log("Backfill de colapso de tipos completo.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
