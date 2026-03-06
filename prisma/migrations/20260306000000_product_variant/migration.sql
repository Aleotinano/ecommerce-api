-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "color" TEXT,
    "size" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "stock" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "img" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProductVariant_sku_key" UNIQUE ("sku")
);

-- Foreign key for productId
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed variants for existing products
INSERT INTO "ProductVariant" ("productId", "color", "size", "price", "stock", "sku", "img", "isActive")
SELECT "id", "color", "size", "price", "stock", 'SKU-' || "id", "img", "isActive" FROM "Product";

-- Add variant references in CartItem
ALTER TABLE "CartItem" ADD COLUMN "variantId" INTEGER;

UPDATE "CartItem"
SET "variantId" = pv."id"
FROM "ProductVariant" pv
WHERE pv."productId" = "CartItem"."productId";

ALTER TABLE "CartItem" ALTER COLUMN "variantId" SET NOT NULL;

DROP INDEX IF EXISTS "CartItem_cartId_productId_key";
ALTER TABLE "CartItem" DROP CONSTRAINT IF EXISTS "CartItem_productId_fkey";

CREATE UNIQUE INDEX "CartItem_cartId_variantId_key" ON "CartItem"("cartId", "variantId");
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CartItem" DROP COLUMN "productId";

ALTER TABLE "Product" DROP COLUMN "price";
ALTER TABLE "Product" DROP COLUMN "stock";
ALTER TABLE "Product" DROP COLUMN "color";
ALTER TABLE "Product" DROP COLUMN "size";
