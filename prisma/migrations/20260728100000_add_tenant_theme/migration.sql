-- Tema de la tienda editable por el tenant.
-- Todos nullable: null = el storefront usa su default para ese campo, así que un
-- tenant existente no cambia de aspecto al aplicar esta migración.

ALTER TABLE "TenantConfig" ADD COLUMN "themeAccent" TEXT;
ALTER TABLE "TenantConfig" ADD COLUMN "themeRadius" TEXT;
ALTER TABLE "TenantConfig" ADD COLUMN "themeFontDisplay" TEXT;
ALTER TABLE "TenantConfig" ADD COLUMN "themeFontBody" TEXT;
ALTER TABLE "TenantConfig" ADD COLUMN "themeDensity" TEXT;

-- El accent termina como valor de una CSS custom property en un atributo `style`.
-- Zod ya lo valida en la entrada; este CHECK es la red de abajo, para que ningún
-- camino alternativo (script, psql a mano, seed) meta algo que no sea #rrggbb.
-- Declarado SOLO acá y no en schema.prisma: Prisma no modela CHECKs y ponerlo
-- allá haría que `migrate diff` genere drift en cada corrida.
ALTER TABLE "TenantConfig" ADD CONSTRAINT "TenantConfig_theme_accent_hex_check" CHECK (
  "themeAccent" IS NULL OR "themeAccent" ~ '^#[0-9a-fA-F]{6}$'
);

-- Forma y densidad son enums del contrato compartido. Se validan como texto porque
-- el catálogo vive en @repo/shared y debe poder crecer sin migración; el CHECK cubre
-- solo los ejes que sí son cerrados y estables.
ALTER TABLE "TenantConfig" ADD CONSTRAINT "TenantConfig_theme_radius_check" CHECK (
  "themeRadius" IS NULL OR "themeRadius" IN ('duro', 'sutil', 'suave', 'redondo')
);

ALTER TABLE "TenantConfig" ADD CONSTRAINT "TenantConfig_theme_density_check" CHECK (
  "themeDensity" IS NULL OR "themeDensity" IN ('compacto', 'aireado')
);
