-- CreateTable
CREATE TABLE "Promo" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Promo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoTier" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "promoId" INTEGER NOT NULL,
    "minQty" INTEGER NOT NULL,
    "discountPercentage" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoProduct" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "promoId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Promo_tenantId_idx" ON "Promo"("tenantId");

-- CreateIndex
CREATE INDEX "PromoTier_tenantId_idx" ON "PromoTier"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PromoTier_promoId_minQty_key" ON "PromoTier"("promoId", "minQty");

-- CreateIndex
CREATE INDEX "PromoProduct_tenantId_idx" ON "PromoProduct"("tenantId");

-- CreateIndex
CREATE INDEX "PromoProduct_productId_idx" ON "PromoProduct"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "PromoProduct_promoId_productId_key" ON "PromoProduct"("promoId", "productId");

-- AddForeignKey
ALTER TABLE "Promo" ADD CONSTRAINT "Promo_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoTier" ADD CONSTRAINT "PromoTier_promoId_fkey" FOREIGN KEY ("promoId") REFERENCES "Promo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoTier" ADD CONSTRAINT "PromoTier_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoProduct" ADD CONSTRAINT "PromoProduct_promoId_fkey" FOREIGN KEY ("promoId") REFERENCES "Promo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoProduct" ADD CONSTRAINT "PromoProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoProduct" ADD CONSTRAINT "PromoProduct_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
