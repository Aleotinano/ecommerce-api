-- AlterEnum
-- Colapsa ProductType de 4 valores (UNIDAD, VARIANTE, COMBO, PRODUCTO — ver migración de
-- expand `20260710120000_product_types_collapse_expand`) a 2 (PRODUCTO, COMBO). Postgres
-- no soporta DROP VALUE en un enum, así que se recrea el tipo y se migra la columna con
-- USING, mapeando cualquier UNIDAD/VARIANTE remanente a PRODUCTO — el backfill manual
-- `prisma/migrate-collapse-product-types.js` (corrido entre esta migración y la de
-- expand) ya garantizó que todo producto no-COMBO tiene su variante default antes de
-- este paso.
ALTER TYPE "ProductType" RENAME TO "ProductType_old";
CREATE TYPE "ProductType" AS ENUM ('PRODUCTO', 'COMBO');
ALTER TABLE "Product" ALTER COLUMN "type" TYPE "ProductType"
  USING (CASE WHEN "type"::text = 'COMBO' THEN 'COMBO' ELSE 'PRODUCTO' END)::"ProductType";
DROP TYPE "ProductType_old";

-- AlterTable
-- Product.price pasa a ser exclusivo del precio fijo de COMBO — para PRODUCTO el precio
-- real vive siempre en la variante default (ProductVariant.price, ver abajo).
ALTER TABLE "Product" ALTER COLUMN "price" DROP NOT NULL;

-- AlterTable
-- Product.stock se elimina: el backfill ya copió su valor a la variante default de cada
-- producto ex-UNIDAD/VARIANTE (prisma/migrate-collapse-product-types.js).
ALTER TABLE "Product" DROP COLUMN "stock";

-- AlterTable
-- ProductVariant.price deja de admitir NULL ("hereda Product.price"): el backfill ya
-- resolvió cualquier NULL existente antes de este paso.
ALTER TABLE "ProductVariant" ALTER COLUMN "price" SET NOT NULL;
