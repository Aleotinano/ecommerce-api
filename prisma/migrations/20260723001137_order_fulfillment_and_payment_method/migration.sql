-- CreateEnum
CREATE TYPE "FulfillmentMethod" AS ENUM ('DELIVERY', 'PICKUP');

-- CreateEnum
CREATE TYPE "OrderPaymentMethod" AS ENUM ('CASH', 'TRANSFER', 'MIXED');

-- AlterTable
-- `paymentMethod` solo contenía valores placeholder de seed ("seed-order"),
-- nunca escritos por código real (ver docs/servicios/dominio/Órdenes.md) —
-- se dropea y recrea tipado en vez de castear.
ALTER TABLE "Order" ADD COLUMN     "addressDetails" TEXT,
ADD COLUMN     "addressLat" DOUBLE PRECISION,
ADD COLUMN     "addressLng" DOUBLE PRECISION,
ADD COLUMN     "addressText" TEXT,
ADD COLUMN     "fulfillmentMethod" "FulfillmentMethod",
ADD COLUMN     "paymentNote" TEXT,
ADD COLUMN     "transferConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "transferConfirmedById" INTEGER,
DROP COLUMN "paymentMethod",
ADD COLUMN     "paymentMethod" "OrderPaymentMethod";
