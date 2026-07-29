-- READY: estado intermedio "listo para retirar/enviar", que hasta ahora quedaba
-- tapado dentro de PROCESSING. Se inserta ANTES de COMPLETED en el tipo porque
-- Postgres ordena los enums por posición de declaración, y un `ORDER BY status`
-- tiene que seguir el orden lógico del flujo. `IF NOT EXISTS` para que la
-- migración sea reentrante en una DB que ya la haya aplicado a mano.
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'READY' BEFORE 'COMPLETED';

-- CreateEnum
CREATE TYPE "StatusTrigger" AS ENUM ('MANUAL', 'AUTO', 'GATEWAY');

-- AlterTable: quién movió el estado. Las filas históricas quedan como MANUAL,
-- que es exactamente lo que eran: hasta hoy el único camino era el PATCH.
ALTER TABLE "OrderStatusHistory" ADD COLUMN     "trigger" "StatusTrigger" NOT NULL DEFAULT 'MANUAL';
