-- Fase 5 (endurecer) de la migración expand-contract de tipos de producto: una vez que
-- prisma/migrate-product-types.js backfilleó `Product.type` y `productId` en
-- CartItem/OrderItem para todas las filas existentes, se pueden endurecer a NOT NULL.
-- `variantId` en CartItem/OrderItem NO se endurece: es legítimamente NULL para
-- productos UNIDAD/COMBO.

-- DropForeignKey
ALTER TABLE "CartItem" DROP CONSTRAINT "CartItem_productId_fkey";

-- DropForeignKey
ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_productId_fkey";

-- AlterTable
ALTER TABLE "CartItem" ALTER COLUMN "productId" SET NOT NULL;

-- AlterTable
ALTER TABLE "OrderItem" ALTER COLUMN "productId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Product" ALTER COLUMN "type" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
