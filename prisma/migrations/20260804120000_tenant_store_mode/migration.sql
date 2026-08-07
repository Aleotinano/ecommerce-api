-- Modo de tienda: hay clientes cuyo catálogo se LEE, no se compra.
--
-- El primero fue Shifu (restaurante por reserva) y ahora se suma una cafetería. En los
-- dos casos el storefront resolvió el asunto no montando el carrito, lo cual funciona
-- mientras nadie escriba /checkout en la barra de direcciones. Que sea un dato del
-- tenant es lo que permite apagar esa ruta de verdad, y que un tercer cliente del rubro
-- no vuelva a resolverlo a mano.
--
-- No modela "restaurante": modela QUÉ HACE el cliente con el catálogo. Una cafetería,
-- un restaurante y una casa de repuestos que solo publica precios comparten este modo y
-- no comparten rubro.

-- Default 'SHOP' = el comportamiento de siempre, así que la migración no cambia a
-- ningún tenant existente. NOT NULL porque no hay tercer estado: o se vende o no.
ALTER TABLE "TenantConfig" ADD COLUMN "storeMode" TEXT NOT NULL DEFAULT 'SHOP';

-- Enum cerrado y estable → CHECK, igual que customerPhoneMode y themeRadius. Vive solo
-- acá y no en schema.prisma para no generar drift en `migrate diff`.
ALTER TABLE "TenantConfig" ADD CONSTRAINT "TenantConfig_store_mode_check" CHECK (
  "storeMode" IN ('SHOP', 'MENU')
);
