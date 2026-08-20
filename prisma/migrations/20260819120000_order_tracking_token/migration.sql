-- Seguimiento de pedidos de invitado.
--
-- El storefront de tenant se compra sin cuenta, y hasta acá lo único que el cliente
-- veía de su pedido era la respuesta del POST, guardada en el sessionStorage del
-- navegador: si cerraba la pestaña, se perdía. `GET /store/orders/:id` exige token de
-- cuenta y un invitado no tiene con qué probar que la orden es suya.
--
-- Lo que se agrega es una credencial POR PEDIDO: 128 bits aleatorios que viajan en el
-- link, en el mensaje de WhatsApp y en el navegador de la persona. Se guarda el hash y
-- no el token, igual que `User.emailVerificationTokenHash`.
--
-- Por qué no el teléfono como identidad: un teléfono es público —está en el estado de
-- WhatsApp, en el grupo del barrio—, así que "tipeá tu número y mirá tus pedidos" deja
-- que cualquiera lea los pedidos de cualquiera con una sola request. Y la IP no puede
-- completarlo: con CGNAT decenas de abonados comparten la de egreso, y la misma persona
-- la cambia al pasar de datos a WiFi.
ALTER TABLE "Order" ADD COLUMN "trackingTokenHash" TEXT;

-- UNIQUE y no un índice común: dos pedidos con el mismo token sería un choque de
-- credenciales, y el índice además es lo que hace barata la búsqueda por token (es la
-- única forma de entrar a esa fila desde la ruta pública).
CREATE UNIQUE INDEX "Order_trackingTokenHash_key" ON "Order"("trackingTokenHash");
