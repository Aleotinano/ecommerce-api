-- La caja pasa a llevar DOS saldos continuos: el efectivo del cajón y lo que hay en
-- la cuenta. Hasta acá las transferencias solo se acumulaban dentro de cada turno
-- (`transferTotal`) y no arrastraban: cada turno empezaba la cuenta del banco en
-- cero, aunque la plata siguiera ahí.

-- AlterTable
ALTER TABLE "CashRegisterSession"
  ADD COLUMN "openingTransferAmount"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "expectedTransferAmount" DOUBLE PRECISION,
  ADD COLUMN "countedTransferAmount"  DOUBLE PRECISION,
  ADD COLUMN "transferDifference"     DOUBLE PRECISION;

-- ---------------------------------------------------------------------------
-- Agregado a mano, igual que el resto de los CHECKs de la caja: Prisma no los
-- declara desde el schema.
-- ---------------------------------------------------------------------------

-- Espejo de "CashRegisterSession_opening_nonneg_check": no se abre una caja
-- declarando un saldo negativo.
ALTER TABLE "CashRegisterSession" ADD CONSTRAINT "CashRegisterSession_opening_transfer_nonneg_check"
  CHECK ("openingTransferAmount" >= 0);

-- Un turno ABIERTO no puede tener arqueo de transferencias: como con el efectivo, ese
-- número se escribe al cerrar y no antes.
--
-- Un turno CERRADO tampoco lo exige, a diferencia de `countedCashAmount`: contar el
-- banco es opcional (el local que no lo mira no firma una diferencia que nadie
-- verificó), y los turnos cerrados antes de esta migración no lo tienen. Backfillear
-- un conteo sería inventar plata contada.
ALTER TABLE "CashRegisterSession" DROP CONSTRAINT "CashRegisterSession_close_complete_check";

ALTER TABLE "CashRegisterSession" ADD CONSTRAINT "CashRegisterSession_close_complete_check" CHECK (
  ("status" = 'OPEN'   AND "closedAt" IS NULL     AND "countedCashAmount" IS NULL
                       AND "closedWithoutCount" = false
                       AND "countedTransferAmount" IS NULL
                       AND "transferDifference" IS NULL) OR
  ("status" = 'CLOSED' AND "closedAt" IS NOT NULL AND
    (("countedCashAmount" IS NOT NULL AND "closedWithoutCount" = false) OR
     ("countedCashAmount" IS NULL     AND "closedWithoutCount" = true)))
);
