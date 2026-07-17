-- Generaliza color/size de ProductVariant a atributos flexibles por tenant:
--  1) expand: columna JSONB `attributes` + tabla `TenantAttribute` (catálogo por tenant)
--  2) backfill: color -> attributes.color, size -> attributes.talle; y se crea el
--     catálogo (color/talle) para los tenants que ya usaban esas columnas
--  3) contract: se eliminan las columnas `color` y `size`
-- Editada a mano sobre el SQL generado por prisma (igual criterio que
-- `product_types_collapse_*`): acá el backfill es SQL puro, así que expand+backfill+
-- contract van en una sola migración.

-- CreateEnum
CREATE TYPE "AttributeType" AS ENUM ('TEXT', 'COLOR');

-- AlterTable (expand)
ALTER TABLE "ProductVariant" ADD COLUMN "attributes" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "TenantAttribute" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "AttributeType" NOT NULL DEFAULT 'TEXT',
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TenantAttribute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantAttribute_tenantId_idx" ON "TenantAttribute"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantAttribute_tenantId_key_key" ON "TenantAttribute"("tenantId", "key");

-- AddForeignKey
ALTER TABLE "TenantAttribute" ADD CONSTRAINT "TenantAttribute_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: color/size -> attributes ("size" pasa a la key "talle", el nombre con el
-- que el dominio habla de ese atributo). jsonb_strip_nulls omite las keys en null.
UPDATE "ProductVariant"
SET "attributes" = jsonb_strip_nulls(
  jsonb_build_object('color', "color", 'talle', "size")
);

-- Catálogo para los tenants que ya venían usando color y/o size.
INSERT INTO "TenantAttribute" ("tenantId", "key", "label", "type", "position")
SELECT DISTINCT "tenantId", 'color', 'Color', 'COLOR'::"AttributeType", 0
FROM "ProductVariant" WHERE "color" IS NOT NULL;

INSERT INTO "TenantAttribute" ("tenantId", "key", "label", "type", "position")
SELECT DISTINCT "tenantId", 'talle', 'Talle', 'TEXT'::"AttributeType", 1
FROM "ProductVariant" WHERE "size" IS NOT NULL;

-- AlterTable (contract)
ALTER TABLE "ProductVariant" DROP COLUMN "color",
DROP COLUMN "size";
