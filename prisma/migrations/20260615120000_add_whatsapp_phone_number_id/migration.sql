-- AlterTable
ALTER TABLE "TenantConfig" ADD COLUMN "whatsappPhoneNumberId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "TenantConfig_whatsappPhoneNumberId_key" ON "TenantConfig"("whatsappPhoneNumberId");
