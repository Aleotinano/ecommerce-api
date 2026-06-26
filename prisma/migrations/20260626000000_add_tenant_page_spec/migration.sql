-- CreateTable
CREATE TABLE "TenantPageSpec" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "draftSpec" JSONB,
    "publishedSpec" JSONB,
    "version" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantPageSpec_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantPageSpec_tenantId_key" ON "TenantPageSpec"("tenantId");

-- CreateIndex
CREATE INDEX "TenantPageSpec_tenantId_idx" ON "TenantPageSpec"("tenantId");

-- AddForeignKey
ALTER TABLE "TenantPageSpec" ADD CONSTRAINT "TenantPageSpec_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
