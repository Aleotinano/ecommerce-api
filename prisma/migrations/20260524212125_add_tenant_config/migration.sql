-- CreateTable
CREATE TABLE "TenantConfig" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "logoUrl" TEXT,
    "logoPublicId" TEXT,
    "storeName" TEXT,
    "storeDescription" TEXT,
    "storeTagline" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "contactAddress" TEXT,
    "socialInstagram" TEXT,
    "socialTiktok" TEXT,
    "socialFacebook" TEXT,
    "socialTwitter" TEXT,
    "socialYoutube" TEXT,
    "socialPinterest" TEXT,
    "socialWhatsapp" TEXT,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "seoKeywords" TEXT,
    "shippingPolicy" TEXT,
    "returnsPolicy" TEXT,
    "privacyPolicy" TEXT,
    "currency" TEXT DEFAULT 'ARS',
    "locale" TEXT DEFAULT 'es-AR',
    "showOutOfStock" BOOLEAN NOT NULL DEFAULT false,
    "allowCartGuest" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantConfig_tenantId_key" ON "TenantConfig"("tenantId");

-- CreateIndex
CREATE INDEX "TenantConfig_tenantId_idx" ON "TenantConfig"("tenantId");

-- AddForeignKey
ALTER TABLE "TenantConfig" ADD CONSTRAINT "TenantConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
