-- CreateEnum
CREATE TYPE "PaymentChannel" AS ENUM ('CASH', 'TRANSFER', 'GATEWAY');

-- CreateEnum
CREATE TYPE "OrderPaymentKind" AS ENUM ('DEPOSIT', 'PAYMENT', 'REFUND');

-- CreateTable
CREATE TABLE "OrderPayment" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "orderId" INTEGER NOT NULL,
    "kind" "OrderPaymentKind" NOT NULL,
    "channel" "PaymentChannel" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "confirmedById" INTEGER,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderPayment_orderId_idx" ON "OrderPayment"("orderId");

-- CreateIndex
CREATE INDEX "OrderPayment_tenantId_idx" ON "OrderPayment"("tenantId");

-- AddForeignKey
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK: el monto de un cobro es SIEMPRE positivo; el signo lo aporta `kind`
-- (PAYMENT_SIGN en services/order-state.js). Se agrega a mano porque `@@check` no
-- existe en el DSL de Prisma — mismo motivo que "CashMovement"/"Cart_owner_xor_check".
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_amount_positive_check" CHECK ("amount" > 0);

-- ---------------------------------------------------------------------------
-- BACKFILL: reconstruye el libro a partir de los sellos que existen hoy.
--
-- El orden de los pasos importa: cada uno descuenta lo que los anteriores ya
-- registraron para esa orden, así una orden con seña + cobro total termina con dos
-- filas que suman el total, no con dos filas que suman de más.
--
-- `paymentStatus` NO se recalcula acá: las órdenes viejas conservan el valor que
-- ya tenían, y `derivePaymentStatus` solo corre de acá en adelante, cuando el libro
-- cambia. Es lo que garantiza que la migración no mueva ningún estado de pago.
-- ---------------------------------------------------------------------------

-- 1. Seña confirmada. El canal no está guardado en ningún lado: se deriva del
--    método de pago, y ante la duda (MIXED, o sin método definido todavía) se asume
--    TRANSFER, que es el caso que `confirmDeposit` describe — "el dueño verificó la
--    transferencia a ojo".
INSERT INTO "OrderPayment" ("tenantId", "orderId", "kind", "channel", "amount", "note", "confirmedById", "confirmedAt")
SELECT
  o."tenantId",
  o."id",
  'DEPOSIT',
  CASE WHEN o."paymentMethod" = 'CASH' THEN 'CASH'::"PaymentChannel" ELSE 'TRANSFER'::"PaymentChannel" END,
  o."depositAmount",
  'backfill: sello depositConfirmedAt',
  o."depositConfirmedById",
  o."depositConfirmedAt"
FROM "Order" o
WHERE o."depositConfirmedAt" IS NOT NULL
  AND COALESCE(o."depositAmount", 0) > 0;

-- 2. Transferencia confirmada. El sello no dice cuánto entró, así que se asume la
--    parte que la orden esperaba por transferencia, descontando lo que ya haya
--    aportado la seña por esa misma vía.
INSERT INTO "OrderPayment" ("tenantId", "orderId", "kind", "channel", "amount", "note", "confirmedById", "confirmedAt")
SELECT
  o."tenantId",
  o."id",
  'PAYMENT',
  'TRANSFER',
  ROUND((esperado.monto - COALESCE(ya.monto, 0))::numeric, 2)::double precision,
  'backfill: sello transferConfirmedAt',
  o."transferConfirmedById",
  o."transferConfirmedAt"
FROM "Order" o
CROSS JOIN LATERAL (
  SELECT CASE
    WHEN o."paymentMethod" = 'MIXED' THEN COALESCE(o."transferAmount", 0)
    WHEN o."paymentMethod" = 'TRANSFER' THEN o."total"
    ELSE 0
  END AS monto
) esperado
LEFT JOIN LATERAL (
  SELECT SUM(p."amount") AS monto
  FROM "OrderPayment" p
  WHERE p."orderId" = o."id" AND p."channel" = 'TRANSFER'
) ya ON TRUE
WHERE o."transferConfirmedAt" IS NOT NULL
  AND (esperado.monto - COALESCE(ya.monto, 0)) > 0.005;

-- 3. Cobro total confirmado a mano: lo que falte para llegar al total de la orden.
--    Con MIXED el remanente se asume en efectivo, que es lo que queda cuando la
--    parte transferida ya se registró en el paso anterior.
INSERT INTO "OrderPayment" ("tenantId", "orderId", "kind", "channel", "amount", "note", "confirmedById", "confirmedAt")
SELECT
  o."tenantId",
  o."id",
  'PAYMENT',
  CASE WHEN o."paymentMethod" = 'TRANSFER' THEN 'TRANSFER'::"PaymentChannel" ELSE 'CASH'::"PaymentChannel" END,
  ROUND((o."total" - COALESCE(ya.monto, 0))::numeric, 2)::double precision,
  'backfill: sello paymentConfirmedAt',
  o."paymentConfirmedById",
  o."paymentConfirmedAt"
FROM "Order" o
LEFT JOIN LATERAL (
  SELECT SUM(p."amount") AS monto FROM "OrderPayment" p WHERE p."orderId" = o."id"
) ya ON TRUE
WHERE o."paymentConfirmedAt" IS NOT NULL
  AND (o."total" - COALESCE(ya.monto, 0)) > 0.005;

-- 4. Pagos de MercadoPago ya aprobados: una fila GATEWAY por el total. Solo para
--    órdenes sin ninguna fila previa — si hubo confirmaciones manuales, esas mandan.
INSERT INTO "OrderPayment" ("tenantId", "orderId", "kind", "channel", "amount", "note", "confirmedById", "confirmedAt")
SELECT
  o."tenantId",
  o."id",
  'PAYMENT',
  'GATEWAY',
  o."total",
  'backfill: paymentStatus APPROVED (MercadoPago)',
  NULL,
  o."updatedAt"
FROM "Order" o
WHERE o."paymentStatus" = 'APPROVED'
  AND o."total" > 0
  AND NOT EXISTS (SELECT 1 FROM "OrderPayment" p WHERE p."orderId" = o."id");
