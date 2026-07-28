-- Peso tipográfico por rol. Nullable: null = el storefront usa su default para
-- ese campo, así que ningún tenant existente cambia de aspecto al migrar.

ALTER TABLE "TenantConfig" ADD COLUMN "themeWeightDisplay" TEXT;
ALTER TABLE "TenantConfig" ADD COLUMN "themeWeightBody" TEXT;

-- Mismo criterio que el resto del tema: los ejes cerrados y estables llevan CHECK
-- en la DB como red de abajo, declarado SOLO acá (Prisma no modela CHECKs y
-- ponerlo en schema.prisma haría que `migrate diff` genere drift en cada corrida).
ALTER TABLE "TenantConfig" ADD CONSTRAINT "TenantConfig_theme_weight_display_check" CHECK (
  "themeWeightDisplay" IS NULL OR "themeWeightDisplay" IN ('400', '500', '600', '700')
);

ALTER TABLE "TenantConfig" ADD CONSTRAINT "TenantConfig_theme_weight_body_check" CHECK (
  "themeWeightBody" IS NULL OR "themeWeightBody" IN ('400', '500', '600', '700')
);
