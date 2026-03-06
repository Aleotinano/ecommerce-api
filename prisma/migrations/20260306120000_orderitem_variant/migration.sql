-- Add new variantId column
ALTER TABLE "OrderItem" ADD COLUMN "variantId" INTEGER;

-- Map existing rows to the first variant that belongs to the same product
UPDATE "OrderItem"
SET "variantId" = (
  SELECT "id" FROM "ProductVariant"
  WHERE "productId" = "OrderItem"."productId"
  ORDER BY "id"
  LIMIT 1
)
WHERE "variantId" IS NULL;

-- Ensure every order item has a variant
ALTER TABLE "OrderItem" ALTER COLUMN "variantId" SET NOT NULL;

-- Recreate unique constraint and FK for variant
DROP INDEX IF EXISTS "OrderItem_orderId_productId_key";
ALTER TABLE "OrderItem" DROP CONSTRAINT IF EXISTS "OrderItem_productId_fkey";

CREATE UNIQUE INDEX "OrderItem_orderId_variantId_key" ON "OrderItem"("orderId", "variantId");
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Drop old productId column
ALTER TABLE "OrderItem" DROP COLUMN "productId";
