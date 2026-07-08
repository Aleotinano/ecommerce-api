-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('UNIDAD', 'VARIANTE', 'COMBO');

-- DropForeignKey
ALTER TABLE "CartItem" DROP CONSTRAINT "CartItem_variantId_fkey";

-- DropForeignKey
ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_variantId_fkey";

-- DropIndex
DROP INDEX "CartItem_cartId_variantId_key";

-- AlterTable
ALTER TABLE "CartItem" ADD COLUMN     "productId" INTEGER,
ALTER COLUMN "variantId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "productId" INTEGER,
ALTER COLUMN "variantId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "stock" INTEGER,
ADD COLUMN     "type" "ProductType";

-- CreateIndex
CREATE UNIQUE INDEX "CartItem_cartId_productId_variantId_key" ON "CartItem"("cartId", "productId", "variantId");

-- CreateIndex (manual, no representable declarativamente en schema.prisma): cierra el
-- hueco de "dos líneas de carrito para el mismo producto UNIDAD/COMBO" — Postgres no
-- colisiona NULL contra NULL en el unique de arriba, así que sin este índice parcial
-- dos CartItem con el mismo (cartId, productId) y variantId NULL podrían coexistir.
-- No declarar este índice en schema.prisma: un futuro `prisma db pull`/`migrate diff`
-- no lo va a ver reflejado ahí y podría marcarlo como drift a "corregir" — es
-- intencional que solo viva en esta migración. Ver prisma/schema.prisma junto a CartItem.
CREATE UNIQUE INDEX "CartItem_cart_product_null_variant_key"
  ON "CartItem"("cartId","productId") WHERE "variantId" IS NULL;

-- CreateIndex
CREATE INDEX "OrderItem_orderId_productId_idx" ON "OrderItem"("orderId", "productId");

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
