-- CreateEnum
CREATE TYPE "SuggestionAngle" AS ENUM ('BEST_SELLER', 'NEW_ARRIVAL', 'LOW_STOCK', 'NO_RECENT_SALES');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "ContentSuggestion" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "angle" "SuggestionAngle" NOT NULL,
    "date" DATE NOT NULL,
    "copy" TEXT,
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "model" TEXT,
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentSuggestion_tenantId_idx" ON "ContentSuggestion"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentSuggestion_tenantId_date_key" ON "ContentSuggestion"("tenantId", "date");

-- AddForeignKey
ALTER TABLE "ContentSuggestion" ADD CONSTRAINT "ContentSuggestion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentSuggestion" ADD CONSTRAINT "ContentSuggestion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
