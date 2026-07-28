-- Teléfono del cliente.
--
-- El problema que cierra: una orden nacida en el storefront llegaba al panel sin
-- ninguna forma de contactar a quien compró. `Order.contactPhone` ya existía,
-- pero solo lo llenaban las órdenes del bot (donde el número viene gratis en el
-- webhook de WhatsApp); `User` directamente no tenía teléfono y el checkout
-- nunca lo pedía.
--
-- El teléfono NO es una credencial: no se loguea con él, no lleva unique y no
-- reemplaza al email. Es dato de contacto. Login por celular es otra obra
-- (OTP, verificación, recuperación) y no se empieza acá.

-- Dígitos E.164, ya normalizados por lib/phone.js. Nullable porque las cuentas
-- existentes no lo tienen y porque el tenant puede elegir no pedirlo.
ALTER TABLE "User" ADD COLUMN "phone" TEXT;

ALTER TABLE "TenantConfig" ADD COLUMN "customerPhoneMode" TEXT DEFAULT 'required';
ALTER TABLE "TenantConfig" ADD COLUMN "customerPhoneCountry" TEXT DEFAULT '54';
ALTER TABLE "TenantConfig" ADD COLUMN "customerPhoneArea" TEXT;

-- Enum cerrado y estable → CHECK, igual que themeRadius/themeDensity. Vive solo
-- acá y no en schema.prisma para no generar drift en `migrate diff`.
ALTER TABLE "TenantConfig" ADD CONSTRAINT "TenantConfig_customer_phone_mode_check" CHECK (
  "customerPhoneMode" IS NULL OR "customerPhoneMode" IN ('off', 'optional', 'required')
);

-- País y característica terminan concatenados a un número que se manda a wa.me.
-- Solo dígitos: cualquier otra cosa acá produciría una URL con basura pegada.
ALTER TABLE "TenantConfig" ADD CONSTRAINT "TenantConfig_customer_phone_country_check" CHECK (
  "customerPhoneCountry" IS NULL OR "customerPhoneCountry" ~ '^[0-9]{1,4}$'
);

ALTER TABLE "TenantConfig" ADD CONSTRAINT "TenantConfig_customer_phone_area_check" CHECK (
  "customerPhoneArea" IS NULL OR "customerPhoneArea" ~ '^[0-9]{2,5}$'
);

-- Dígitos y largo E.164. El `+` y los separadores los saca lib/phone.js antes de
-- llegar acá, así que un valor con formato es señal de que alguien escribió
-- salteándose la normalización.
ALTER TABLE "User" ADD CONSTRAINT "User_phone_digits_check" CHECK (
  "phone" IS NULL OR "phone" ~ '^[0-9]{8,15}$'
);

-- A propósito NO se le pone el mismo CHECK a "Order"."contactPhone": esa columna
-- es preexistente y la escribe también el bot de WhatsApp, que guarda el wa_id
-- con el formato que le llega del webhook (hay filas y fixtures con "+54..."). Un
-- CHECK acá rompería ese camino de entrada por un problema que no es suyo. Lo que
-- escribe el checkout sí pasa por normalizeCustomerPhone en services/orders.js.
