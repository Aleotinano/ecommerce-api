-- Miembros explícitos de una regla de categoría de combo: una fila de
-- ComboAllowedProduct puede quedar ligada a la ComboAllowedCategory que la
-- originó (null = regla standalone legacy per-producto). Borrar la regla de
-- categoría cascadea sus miembros.

-- AlterTable
ALTER TABLE "ComboAllowedProduct" ADD COLUMN "comboAllowedCategoryId" INTEGER;

-- AddForeignKey
ALTER TABLE "ComboAllowedProduct" ADD CONSTRAINT "ComboAllowedProduct_comboAllowedCategoryId_fkey"
  FOREIGN KEY ("comboAllowedCategoryId") REFERENCES "ComboAllowedCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "ComboAllowedProduct_comboAllowedCategoryId_idx" ON "ComboAllowedProduct"("comboAllowedCategoryId");
