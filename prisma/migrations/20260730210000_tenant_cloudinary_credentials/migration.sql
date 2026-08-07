-- Cuenta de Cloudinary por tenant.
--
-- El deploy es una instancia multi-tenant única, así que "una cuenta por cliente"
-- no se resuelve con un `.env` por deploy: las credenciales se resuelven por
-- tenant en runtime (lib/cloudinary.js). Los tres NULL = cuenta global de env.
ALTER TABLE "TenantConfig" ADD COLUMN "cloudinaryCloudName" TEXT;
ALTER TABLE "TenantConfig" ADD COLUMN "cloudinaryApiKey" TEXT;
ALTER TABLE "TenantConfig" ADD COLUMN "cloudinaryApiSecret" TEXT;

-- Van los tres o ninguno. Media credencial cargada es un tenant que sube a ningún
-- lado, y el modo de falla sería una subida que revienta recién en producción.
-- Hay un superRefine equivalente en schemas/tenant-config.schema.js.
ALTER TABLE "TenantConfig" ADD CONSTRAINT "TenantConfig_cloudinary_credentials_check" CHECK (
  (
    "cloudinaryCloudName" IS NULL
    AND "cloudinaryApiKey" IS NULL
    AND "cloudinaryApiSecret" IS NULL
  )
  OR (
    "cloudinaryCloudName" IS NOT NULL
    AND "cloudinaryApiKey" IS NOT NULL
    AND "cloudinaryApiSecret" IS NOT NULL
  )
);

-- En qué cuenta quedó cada comprobante. NULL = la cuenta global (todas las filas
-- que ya existen). Un tenant puede cargar su cuenta DESPUÉS de haber recibido
-- comprobantes: sin esta columna, los viejos se firmarían contra la cuenta nueva y
-- la URL 404earía en silencio.
ALTER TABLE "OrderReceipt" ADD COLUMN "cloudName" TEXT;
