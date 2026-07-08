// Backfill puntual: crea una ProductVariant default (color/size null) para
// productos existentes sin ninguna variante. Necesario porque Product no tiene
// columnas propias de stock/sku - sin esto, esos productos son invendibles
// (CartItem/OrderItem exigen variantId). Correr una sola vez, manual:
//   node prisma/backfill-default-variants.js
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
    where: { variants: { none: {} } },
  });

  console.log(`Productos sin variantes encontrados: ${products.length}`);

  const reservedSkus = new Set();
  for (const product of products) {
    const sku = await uniqueSku(product.tenantId, product.name, reservedSkus);
    await prisma.productVariant.create({
      data: {
        tenantId: product.tenantId,
        productId: product.id,
        color: null,
        size: null,
        price: null,
        stock: 0,
        sku,
        isActive: false,
      },
    });
    console.log(`  -> variante default creada para producto ${product.id} (${product.name}), sku ${sku}`);
  }

  console.log("Backfill completo.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
