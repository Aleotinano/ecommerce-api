-- Fija una regla de combo a UNA variante puntual del producto permitido.
--
-- Hasta acá la whitelist apuntaba solo al Product, así que un combo que dice
-- "lleva la caja x12" habilitaba también la x48: el combo se cobraba igual y se
-- llevaba el pack caro. Lo sufren 7 de las 11 promos de punto-healthy.
--
-- La columna nace NULLABLE a propósito: null = cualquier variante activa, que es
-- el comportamiento histórico. Por eso la migración es puramente aditiva y no
-- toca una sola fila existente.

-- AlterTable
ALTER TABLE "ComboAllowedProduct" ADD COLUMN     "allowedVariantId" INTEGER;

-- CreateIndex
CREATE INDEX "ComboAllowedProduct_allowedVariantId_idx" ON "ComboAllowedProduct"("allowedVariantId");

-- AddForeignKey
ALTER TABLE "ComboAllowedProduct" ADD CONSTRAINT "ComboAllowedProduct_allowedVariantId_fkey" FOREIGN KEY ("allowedVariantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
