-- El cierre pasa a partir el efectivo contado en dos: lo que se RETIRA (caja grande) y
-- lo que QUEDA en el cajón (caja chica).
--
-- Hasta acá cerrar reabría el turno siguiente con TODO lo contado, que asumía que la
-- plata se queda en el local. En el local real se lleva todos los días y queda un fondo
-- chico para arrancar: sin esto, la caja de mañana amanecía con plata que ya no está.
--
-- La caja chica es un valor DERIVADO (contado − retirado) pero se guarda igual: es lo
-- que abre el turno siguiente y lo que arrastra una apertura manual, y recalcularlo a
-- partir de un arqueo firmado sería recalcular un snapshot.

-- AlterTable
ALTER TABLE "CashRegisterSession"
  ADD COLUMN "withdrawnCashAmount" DOUBLE PRECISION,
  ADD COLUMN "pettyCashAmount"     DOUBLE PRECISION;

-- ---------------------------------------------------------------------------
-- CHECKs a mano, igual que el resto de los de la caja: Prisma no los declara desde el
-- schema.
-- ---------------------------------------------------------------------------

-- Los dos son NULL en un turno abierto y en un cierre sin conteo (nadie contó, nadie
-- retiró); cuando existen, no pueden ser negativos. A diferencia de los saldos de
-- apertura acá no hay continuación derivada que pueda dar negativo: los dos salen de un
-- conteo que una persona declaró.
ALTER TABLE "CashRegisterSession" ADD CONSTRAINT "CashRegisterSession_withdrawn_nonneg_check"
  CHECK ("withdrawnCashAmount" IS NULL OR "withdrawnCashAmount" >= 0);

ALTER TABLE "CashRegisterSession" ADD CONSTRAINT "CashRegisterSession_petty_nonneg_check"
  CHECK ("pettyCashAmount" IS NULL OR "pettyCashAmount" >= 0);

-- Sin CHECK cruzado `withdrawn <= counted`: eso lo valida Zod en el request, que es
-- donde se puede devolver un error entendible. Acá pelearía con los turnos ya cerrados
-- (que no tienen ninguna de las dos columnas) sin agregar seguridad real.
