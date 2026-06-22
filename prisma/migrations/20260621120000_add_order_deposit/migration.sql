-- AlterEnum: extend PaymentStatus con los estados de seña
ALTER TYPE "PaymentStatus" ADD VALUE 'DEPOSIT_PAID';
ALTER TYPE "PaymentStatus" ADD VALUE 'PAID_IN_FULL';

-- CreateEnum
CREATE TYPE "OrderOrigin" AS ENUM ('ADMIN', 'BOT');

-- AlterTable: userId nullable (órdenes BOT no tienen User registrado)
ALTER TABLE "Order" ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable: procedencia, revisión, seña y contexto de creación
ALTER TABLE "Order" ADD COLUMN "origin" "OrderOrigin" NOT NULL DEFAULT 'ADMIN';
ALTER TABLE "Order" ADD COLUMN "contactPhone" TEXT;
ALTER TABLE "Order" ADD COLUMN "contactName" TEXT;
ALTER TABLE "Order" ADD COLUMN "reviewedById" INTEGER;
ALTER TABLE "Order" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "requiresDeposit" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN "depositAmount" DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN "depositConfirmedById" INTEGER;
ALTER TABLE "Order" ADD COLUMN "depositConfirmedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "creationContext" TEXT;

-- AlterTable: flag y porcentaje de seña por tenant
ALTER TABLE "TenantConfig" ADD COLUMN "depositEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TenantConfig" ADD COLUMN "depositPercentage" INTEGER NOT NULL DEFAULT 50;
