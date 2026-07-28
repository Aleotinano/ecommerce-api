-- Overrides de estilo por sección de la página (nav, hero, catálogo, pie).
-- Nullable: null = ninguna sección pisa nada y todo hereda el tema global, así que
-- ningún tenant existente cambia de aspecto al migrar.

ALTER TABLE "TenantConfig" ADD COLUMN "themeSections" JSONB;

-- A diferencia del resto del tema, acá NO hay CHECK de contenido: la forma del
-- JSON (qué secciones y qué ejes) vive en @repo/shared y evoluciona sin migración.
-- La garantía la dan las dos fronteras de código: Zod al escribir y
-- `normalizeSectionThemes` al renderizar, que descarta todo lo que no reconoce.
-- Lo único que se exige acá es que sea un objeto, no un array ni un escalar:
-- eso sí es estructural y no depende del catálogo.
ALTER TABLE "TenantConfig" ADD CONSTRAINT "TenantConfig_theme_sections_object_check" CHECK (
  "themeSections" IS NULL OR jsonb_typeof("themeSections") = 'object'
);
