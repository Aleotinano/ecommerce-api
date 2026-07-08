-- DropIndex
DROP INDEX "OrderItem_orderId_variantId_key";

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "note" TEXT;

-- CreateIndex
CREATE INDEX "OrderItem_orderId_variantId_idx" ON "OrderItem"("orderId", "variantId");
