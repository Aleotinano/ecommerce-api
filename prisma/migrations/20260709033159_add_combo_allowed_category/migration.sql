-- CreateTable
CREATE TABLE "ComboAllowedCategory" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "comboProductId" INTEGER NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "minQty" INTEGER NOT NULL DEFAULT 0,
    "maxQty" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComboAllowedCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComboAllowedCategory_tenantId_idx" ON "ComboAllowedCategory"("tenantId");

-- CreateIndex
CREATE INDEX "ComboAllowedCategory_comboProductId_idx" ON "ComboAllowedCategory"("comboProductId");

-- CreateIndex
CREATE INDEX "ComboAllowedCategory_categoryId_idx" ON "ComboAllowedCategory"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "ComboAllowedCategory_comboProductId_categoryId_key" ON "ComboAllowedCategory"("comboProductId", "categoryId");

-- AddForeignKey
ALTER TABLE "ComboAllowedCategory" ADD CONSTRAINT "ComboAllowedCategory_comboProductId_fkey" FOREIGN KEY ("comboProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboAllowedCategory" ADD CONSTRAINT "ComboAllowedCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboAllowedCategory" ADD CONSTRAINT "ComboAllowedCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
