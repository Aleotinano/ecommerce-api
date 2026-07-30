-- AlterTable
ALTER TABLE "CashCategory" ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Backfill: las etiquetas reservadas y los movimientos de orden que ya existen.
--
-- Hasta acá los movimientos que venían del libro de cobros entraban con
-- `categoryId NULL` y solo se distinguían por su `type`, así que el resumen "por
-- etiqueta" dejaba las ventas afuera y no sumaba al neto. Con esto el eje de
-- etiquetas cubre el 100% de la plata.
-- ---------------------------------------------------------------------------

-- Una "venta" y una "devolución" por cada tenant que ya tenga catálogo de caja.
-- `position` alta para que queden al final del picker (igual el front no las ofrece:
-- son de sistema y no se pueden usar en un movimiento manual).
INSERT INTO "CashCategory" ("tenantId", "key", "label", "applies", "position", "isActive", "isSystem", "createdAt", "updatedAt")
SELECT DISTINCT c."tenantId", 'venta', 'Venta', 'INCOME'::"CashCategoryApplies", 90, true, true, NOW(), NOW()
FROM "CashCategory" c
ON CONFLICT ("tenantId", "key") DO NOTHING;

INSERT INTO "CashCategory" ("tenantId", "key", "label", "applies", "position", "isActive", "isSystem", "createdAt", "updatedAt")
SELECT DISTINCT c."tenantId", 'devolucion', 'Devolución', 'EXPENSE'::"CashCategoryApplies", 91, true, true, NOW(), NOW()
FROM "CashCategory" c
ON CONFLICT ("tenantId", "key") DO NOTHING;

-- Cobros y señas de órdenes → "venta".
UPDATE "CashMovement" m
SET "categoryId" = c."id"
FROM "CashCategory" c
WHERE c."tenantId" = m."tenantId"
  AND c."key" = 'venta'
  AND m."categoryId" IS NULL
  AND m."type" IN ('ORDER_DEPOSIT', 'ORDER_PAYMENT');

-- Devoluciones al cliente → "devolucion".
UPDATE "CashMovement" m
SET "categoryId" = c."id"
FROM "CashCategory" c
WHERE c."tenantId" = m."tenantId"
  AND c."key" = 'devolucion'
  AND m."categoryId" IS NULL
  AND m."type" = 'ORDER_REFUND';
