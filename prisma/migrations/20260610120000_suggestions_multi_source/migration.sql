-- CreateEnum
CREATE TYPE "SuggestionSource" AS ENUM ('AUTO', 'MANUAL');

-- AlterTable
ALTER TABLE "ContentSuggestion" ADD COLUMN "source" "SuggestionSource" NOT NULL DEFAULT 'AUTO';

-- DropIndex
DROP INDEX "ContentSuggestion_tenantId_date_key";

-- CreateIndex
CREATE UNIQUE INDEX "ContentSuggestion_tenantId_date_productId_angle_key" ON "ContentSuggestion"("tenantId", "date", "productId", "angle");
