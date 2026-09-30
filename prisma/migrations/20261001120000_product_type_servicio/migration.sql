-- Servicios: un tercer tipo de producto que se vende como PRODUCTO (precio por
-- variante) pero sin stock, y cuya línea de pedido lleva el turno: día, hora y para
-- quién. Ver docs/servicios/dominio/Servicios.md.
--
-- Todo es aditivo y nullable: ningún producto ni pedido existente cambia.

-- AlterEnum
-- Postgres no deja USAR un valor de enum en la misma transacción que lo agrega; esta
-- migración solo lo declara, así que no hay problema.
ALTER TYPE "ProductType" ADD VALUE 'SERVICIO';

-- CreateEnum
CREATE TYPE "ServiceRecipient" AS ENUM ('DIRECTO', 'TERCERO', 'AMBOS');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "serviceRecipient" "ServiceRecipient",
ADD COLUMN     "serviceRecipientLabel" TEXT;

-- AlterTable
ALTER TABLE "CartItem" ADD COLUMN     "serviceDate" DATE,
ADD COLUMN     "serviceRecipientName" TEXT,
ADD COLUMN     "serviceTime" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "serviceDate" DATE,
ADD COLUMN     "serviceRecipientName" TEXT,
ADD COLUMN     "serviceTime" TEXT;

-- CreateIndex
CREATE INDEX "OrderItem_serviceDate_idx" ON "OrderItem"("serviceDate");

-- CHECKs a mano (no representables en schema.prisma, mismo criterio que los del
-- resto del schema). El turno es uno solo: día y hora viajan juntos, y un nombre
-- de destinatario sin turno no describe nada. La hora es la de reloj del local,
-- "HH:MM" en 24 h — misma regla que `cashSchedule` (services/cash-register-schedule.js).
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_service_booking_check" CHECK (
  ("serviceDate" IS NULL) = ("serviceTime" IS NULL)
  AND ("serviceRecipientName" IS NULL OR "serviceDate" IS NOT NULL)
  AND ("serviceTime" IS NULL OR "serviceTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_service_booking_check" CHECK (
  ("serviceDate" IS NULL) = ("serviceTime" IS NULL)
  AND ("serviceRecipientName" IS NULL OR "serviceDate" IS NOT NULL)
  AND ("serviceTime" IS NULL OR "serviceTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
