-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "paymentConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "paymentConfirmedById" INTEGER;
