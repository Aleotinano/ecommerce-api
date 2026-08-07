-- Archivado de órdenes: sacar una orden del tablero sin sacarla de la base.
--
-- Las tres columnas son NULLABLE y sin default: todo lo que ya existe queda "no
-- archivado" y por lo tanto visible, que es exactamente el comportamiento de hoy.
-- No hay backfill — el primer cierre de turno de cada tenant barre lo terminal
-- acumulado.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedById" INTEGER,
ADD COLUMN     "cashSessionId" INTEGER;

-- El índice del listado: el where del backoffice es siempre
-- (tenantId, archivedAt IS NULL) + status.
-- CreateIndex
CREATE INDEX "Order_tenantId_archivedAt_idx" ON "Order"("tenantId", "archivedAt");

-- El del historial: "las órdenes de este turno".
-- CreateIndex
CREATE INDEX "Order_tenantId_cashSessionId_idx" ON "Order"("tenantId", "cashSessionId");

-- Coherencia del sello: los tres campos del archivado viajan juntos. `archivedById`
-- puede ser NULL con `archivedAt` presente —el cierre automático por vencimiento del
-- turno no tiene persona detrás, igual que `CashRegisterSession.openedById`—, pero
-- una orden con turno o con autor y sin fecha es una fila a medio escribir.
ALTER TABLE "Order" ADD CONSTRAINT "Order_archive_complete_check"
  CHECK (
    "archivedAt" IS NOT NULL
    OR ("archivedById" IS NULL AND "cashSessionId" IS NULL)
  );
