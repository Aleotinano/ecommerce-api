-- CreateTable
CREATE TABLE "UserAddress" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "addressText" TEXT,
    "addressLat" DOUBLE PRECISION,
    "addressLng" DOUBLE PRECISION,
    "addressDetails" TEXT,
    "addressMapsUrl" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAddress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserAddress_tenantId_idx" ON "UserAddress"("tenantId");

-- CreateIndex
CREATE INDEX "UserAddress_userId_idx" ON "UserAddress"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserAddress_userId_label_key" ON "UserAddress"("userId", "label");

-- AddForeignKey
ALTER TABLE "UserAddress" ADD CONSTRAINT "UserAddress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAddress" ADD CONSTRAINT "UserAddress_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex parcial: garantiza que un usuario tenga a lo sumo una dirección default.
-- No se declara en schema.prisma (Prisma no soporta índices parciales) para no generar
-- drift en `migrate diff` — mismo patrón que "ProductVariant_product_default_key" en
-- prisma/migrations/20260710120000_product_types_collapse_expand/migration.sql.
CREATE UNIQUE INDEX "UserAddress_user_default_key"
  ON "UserAddress"("userId") WHERE "isDefault" = true;

-- CHECK: una dirección necesita al menos una ubicación usable (texto y/o link de Maps),
-- el mismo invariante que `checkFulfillmentConsistency` exige para DELIVERY en
-- schemas/order.schema.js. Se agrega a mano por el mismo motivo que
-- "Cart_owner_xor_check" (ver 20260720120000_cart_guest_support): `@@check` no existe
-- en Prisma y declararlo generaría drift.
ALTER TABLE "UserAddress" ADD CONSTRAINT "UserAddress_location_present_check" CHECK (
  ("addressText" IS NOT NULL) OR ("addressMapsUrl" IS NOT NULL)
);

-- CHECK: lat y lng van juntos o no van, igual que en el checkout.
ALTER TABLE "UserAddress" ADD CONSTRAINT "UserAddress_latlng_together_check" CHECK (
  (("addressLat" IS NULL) AND ("addressLng" IS NULL)) OR
  (("addressLat" IS NOT NULL) AND ("addressLng" IS NOT NULL))
);
