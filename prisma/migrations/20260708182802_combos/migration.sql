-- AlterTable
ALTER TABLE "CartItem" ADD COLUMN     "comboSelection" JSONB;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "parentItemId" INTEGER;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "comboMaxItems" INTEGER,
ADD COLUMN     "comboMinItems" INTEGER,
ADD COLUMN     "isCombo" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ComboAllowedProduct" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "comboProductId" INTEGER NOT NULL,
    "allowedProductId" INTEGER NOT NULL,
    "minQty" INTEGER NOT NULL DEFAULT 0,
    "maxQty" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComboAllowedProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComboAllowedProduct_tenantId_idx" ON "ComboAllowedProduct"("tenantId");

-- CreateIndex
CREATE INDEX "ComboAllowedProduct_comboProductId_idx" ON "ComboAllowedProduct"("comboProductId");

-- CreateIndex
CREATE UNIQUE INDEX "ComboAllowedProduct_comboProductId_allowedProductId_key" ON "ComboAllowedProduct"("comboProductId", "allowedProductId");

-- CreateIndex
CREATE INDEX "OrderItem_parentItemId_idx" ON "OrderItem"("parentItemId");

-- AddForeignKey
ALTER TABLE "ComboAllowedProduct" ADD CONSTRAINT "ComboAllowedProduct_comboProductId_fkey" FOREIGN KEY ("comboProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboAllowedProduct" ADD CONSTRAINT "ComboAllowedProduct_allowedProductId_fkey" FOREIGN KEY ("allowedProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboAllowedProduct" ADD CONSTRAINT "ComboAllowedProduct_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_parentItemId_fkey" FOREIGN KEY ("parentItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
