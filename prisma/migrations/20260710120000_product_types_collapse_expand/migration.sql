-- AlterEnum
-- Se agrega el valor nuevo en su propia migración/transacción, sin usarlo todavía en
-- ninguna otra sentencia acá mismo (Postgres no permite usar un valor de enum recién
-- agregado en la misma transacción que lo crea en versiones no recientes; separarlo es
-- lo seguro). El colapso real de UNIDAD/VARIANTE -> PRODUCTO ocurre en la migración de
-- contract (`product_types_collapse_contract`), después de correr a mano el script de
-- backfill `prisma/migrate-collapse-product-types.js`.
ALTER TYPE "ProductType" ADD VALUE 'PRODUCTO';

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex (manual, no representable declarativamente en schema.prisma): garantiza
-- que un producto tenga a lo sumo una variante "principal" (isDefault=true). Seguro de
-- crear ya en esta fase de expand porque ninguna fila tiene isDefault=true todavía (el
-- backfill que las marca corre después, entre esta migración y la de contract). No
-- declarar este índice en schema.prisma — mismo motivo que
-- `CartItem_cart_product_null_variant_key` (ver ese comentario en
-- `prisma/migrations/20260708190000_product_types_add/migration.sql`): un futuro
-- `prisma db pull`/`migrate diff` no lo va a ver reflejado ahí y podría marcarlo como
-- drift a "corregir" — es intencional que solo viva acá.
CREATE UNIQUE INDEX "ProductVariant_product_default_key"
  ON "ProductVariant"("productId") WHERE "isDefault" = true;
