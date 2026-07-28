-- AlterEnum
ALTER TYPE "OrderOrigin" ADD VALUE 'STORE';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "addressMapsUrl" TEXT,
ADD COLUMN     "cashAmount" DOUBLE PRECISION,
ADD COLUMN     "transferAmount" DOUBLE PRECISION;
