-- CreateEnum
CREATE TYPE "CashSessionTrigger" AS ENUM ('MANUAL', 'AUTO');

-- AlterTable
ALTER TABLE "CashRegisterSession" ADD COLUMN     "closedWithoutCount" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "label" TEXT,
ADD COLUMN     "trigger" "CashSessionTrigger" NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE "TenantConfig" ADD COLUMN     "cashSchedule" JSONB;

-- ---------------------------------------------------------------------------
-- Agregado a mano: el CHECK de completitud del cierre tiene que admitir el turno
-- cerrado SIN conteo (lo cierra el sistema cuando venció y ya arrancó el
-- siguiente). Sigue prohibiendo el caso que importa: un turno CLOSED sin arqueo
-- y sin declararlo, que nadie podría auditar.
-- ---------------------------------------------------------------------------
ALTER TABLE "CashRegisterSession" DROP CONSTRAINT "CashRegisterSession_close_complete_check";

ALTER TABLE "CashRegisterSession" ADD CONSTRAINT "CashRegisterSession_close_complete_check" CHECK (
  ("status" = 'OPEN'   AND "closedAt" IS NULL     AND "countedCashAmount" IS NULL
                       AND "closedWithoutCount" = false) OR
  ("status" = 'CLOSED' AND "closedAt" IS NOT NULL AND
    (("countedCashAmount" IS NOT NULL AND "closedWithoutCount" = false) OR
     ("countedCashAmount" IS NULL     AND "closedWithoutCount" = true)))
);
