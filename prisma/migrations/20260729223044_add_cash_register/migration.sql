-- CreateEnum
CREATE TYPE "CashSessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('ORDER_DEPOSIT', 'ORDER_PAYMENT', 'ORDER_REFUND', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "CashCategoryApplies" AS ENUM ('INCOME', 'EXPENSE', 'BOTH');

-- AlterTable
ALTER TABLE "TenantConfig" ADD COLUMN     "cashRegisterEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CashCategory" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "applies" "CashCategoryApplies" NOT NULL DEFAULT 'EXPENSE',
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashRegisterSession" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "status" "CashSessionStatus" NOT NULL DEFAULT 'OPEN',
    "openingAmount" DOUBLE PRECISION NOT NULL,
    "openedById" INTEGER NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openingNote" TEXT,
    "closedById" INTEGER,
    "closedAt" TIMESTAMP(3),
    "closingNote" TEXT,
    "countedCashAmount" DOUBLE PRECISION,
    "expectedCashAmount" DOUBLE PRECISION,
    "cashDifference" DOUBLE PRECISION,
    "transferTotal" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashRegisterSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "channel" "PaymentChannel" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "categoryId" INTEGER,
    "payee" TEXT,
    "orderId" INTEGER,
    "orderPaymentId" INTEGER,
    "note" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashCategory_tenantId_idx" ON "CashCategory"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CashCategory_tenantId_key_key" ON "CashCategory"("tenantId", "key");

-- CreateIndex
CREATE INDEX "CashRegisterSession_tenantId_idx" ON "CashRegisterSession"("tenantId");

-- CreateIndex
CREATE INDEX "CashRegisterSession_tenantId_status_idx" ON "CashRegisterSession"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CashMovement_orderPaymentId_key" ON "CashMovement"("orderPaymentId");

-- CreateIndex
CREATE INDEX "CashMovement_tenantId_idx" ON "CashMovement"("tenantId");

-- CreateIndex
CREATE INDEX "CashMovement_sessionId_idx" ON "CashMovement"("sessionId");

-- CreateIndex
CREATE INDEX "CashMovement_orderId_idx" ON "CashMovement"("orderId");

-- CreateIndex
CREATE INDEX "CashMovement_categoryId_idx" ON "CashMovement"("categoryId");

-- AddForeignKey
ALTER TABLE "CashCategory" ADD CONSTRAINT "CashCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashRegisterSession" ADD CONSTRAINT "CashRegisterSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CashRegisterSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CashCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Agregado a mano (mismo patrón que 20260727120000_add_user_address): índice
-- parcial + CHECKs que Prisma no puede declarar en el schema.
-- ---------------------------------------------------------------------------

-- UN SOLO turno abierto por tenant. Es LA garantía estructural del módulo: sin
-- esto, dos requests concurrentes de "abrir caja" crean dos sesiones y el arqueo
-- pierde sentido. Índice parcial => no se declara en schema.prisma (Prisma no los
-- soporta y generaría drift en `migrate diff`), mismo motivo que
-- "UserAddress_user_default_key".
CREATE UNIQUE INDEX "CashRegisterSession_tenant_open_key"
  ON "CashRegisterSession"("tenantId") WHERE "status" = 'OPEN';

-- Los montos de caja no pueden ser negativos: el signo lo da `type`, no el número
-- (CASH_MOVEMENT_SIGN, services/cash-register-math.js).
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_amount_positive_check"
  CHECK ("amount" > 0);

-- MercadoPago no pasa por el cajón: que no pueda ni entrar por error. El enganche
-- con el libro de cobros filtra GATEWAY, esto lo hace imposible de saltear.
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_channel_not_gateway_check"
  CHECK ("channel" <> 'GATEWAY');

ALTER TABLE "CashRegisterSession" ADD CONSTRAINT "CashRegisterSession_opening_nonneg_check"
  CHECK ("openingAmount" >= 0);

-- Una sesión cerrada tiene sus campos de cierre; una abierta, ninguno. Sin esto,
-- un update a medias deja un turno "cerrado" sin arqueo, que es un turno que
-- nadie puede auditar.
ALTER TABLE "CashRegisterSession" ADD CONSTRAINT "CashRegisterSession_close_complete_check" CHECK (
  ("status" = 'OPEN'   AND "closedAt" IS NULL     AND "countedCashAmount" IS NULL) OR
  ("status" = 'CLOSED' AND "closedAt" IS NOT NULL AND "countedCashAmount" IS NOT NULL)
);
