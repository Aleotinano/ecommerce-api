// Backfill puntual (Fase 2 de la migración expand-contract de tipos de producto): infiere
// `Product.type` para cada producto existente, mueve stock a `Product.stock` para
// UNIDAD, desactiva variantes sintéticas que dejan de usarse, y backfillea `productId`
// en `CartItem`/`OrderItem` existentes (nulleando `variantId` donde ya no aplica).
// Idempotente: los productos que ya tienen `type` seteado se saltean. Correr una sola
// vez por entorno, manual: node prisma/migrate-product-types.js
import prisma from "../lib/prisma.js";

function inferType(product) {
  if (product.isCombo) return "COMBO";

  const hasRealAttributes = product.variants.some(
    (v) => v.color !== null || v.size !== null
  );
  if (hasRealAttributes || product.variants.length > 1) return "VARIANTE";

  return "UNIDAD";
}

async function main() {
  const products = await prisma.product.findMany({
    where: { type: null },
    include: { variants: true },
  });

  console.log(`Productos sin type: ${products.length}`);

  const counts = { UNIDAD: 0, VARIANTE: 0, COMBO: 0 };

  for (const product of products) {
    const type = inferType(product);
    counts[type] += 1;

    if (type === "UNIDAD") {
      const syntheticVariant = product.variants[0] ?? null;
      const stock = syntheticVariant?.stock ?? 0;

      await prisma.product.update({
        where: { id: product.id },
        data: { type, stock },
      });

      if (syntheticVariant) {
        await prisma.productVariant.update({
          where: { id: syntheticVariant.id },
          data: { isActive: false },
        });
      }
    } else if (type === "COMBO") {
      await prisma.product.update({
        where: { id: product.id },
        data: { type },
      });

      for (const variant of product.variants) {
        if (variant.isActive) {
          await prisma.productVariant.update({
            where: { id: variant.id },
            data: { isActive: false },
          });
        }
      }
    } else {
      // VARIANTE: no toca stock/precio de Product ni las variantes reales.
      await prisma.product.update({
        where: { id: product.id },
        data: { type },
      });
    }

    console.log(`  -> producto ${product.id} (${product.name}) => ${type}`);
  }

  // CartItem/OrderItem existentes: backfillea productId desde variant.productId, y
  // limpia variantId si el producto resultó UNIDAD/COMBO (ya no aplica).
  const [cartItems, orderItems] = await Promise.all([
    prisma.cartItem.findMany({
      where: { productId: null },
      include: { variant: { include: { product: true } } },
    }),
    prisma.orderItem.findMany({
      where: { productId: null },
      include: { variant: { include: { product: true } } },
    }),
  ]);

  for (const item of cartItems) {
    if (!item.variant) continue;
    const productId = item.variant.productId;
    const clearVariant = item.variant.product?.type !== "VARIANTE";
    await prisma.cartItem.update({
      where: { id: item.id },
      data: { productId, variantId: clearVariant ? null : item.variantId },
    });
  }

  for (const item of orderItems) {
    if (!item.variant) continue;
    const productId = item.variant.productId;
    const clearVariant = item.variant.product?.type !== "VARIANTE";
    await prisma.orderItem.update({
      where: { id: item.id },
      data: { productId, variantId: clearVariant ? null : item.variantId },
    });
  }

  console.log(
    `CartItem backfilleados: ${cartItems.length}, OrderItem backfilleados: ${orderItems.length}`
  );
  console.log("Resumen por tipo:", counts);
  console.log("Backfill de tipos completo.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
