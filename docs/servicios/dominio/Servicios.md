---
tags: [servicio, dominio/servicios]
estado: en-desarrollo
ultima-revision: 2026-10-01
lado: backend
---

# Servicios

> [!note] Implementado (backend), v1
> Tercer tipo de [[Productos|producto]]: `Product.type = "SERVICIO"`. Migración
> `20261001120000_product_type_servicio`, reglas del turno en `helpers/service-booking.js` (puro) y
> `schemas/service.schema.js`, y el recorrido completo: alta (`services/productos.js`), variantes
> (`services/variants.js`), [[Carrito]] (`services/cart.js`), [[Órdenes]] (`services/orders.js`:
> `priceItems`, revisión, completar) y el export a Excel. Tests en `tests/services.test.js`.
> Contrato para el frontend: [FRONTEND_SERVICIOS.md](../../../front-md-guia/FRONTEND_SERVICIOS.md).

## Propósito
Muchos de los clientes a los que apunta el sistema combinan **vender productos con prestar
servicios**: una peluquería canina vende alimento y también baña perros; una peluquería corta el
pelo; un catering arma eventos. Lo que el cliente compra en un servicio no es una unidad de
inventario sino **un turno**, y lo que el local necesita saber es:

- **qué** servicio (y qué variante: "perro chico / mediano / grande"),
- **qué día y a qué hora**,
- **para quién** es — el nombre del perro, del hijo, de la empresa.

El servicio entra al catálogo **como un producto más** (misma categoría, mismo listado, mismo
carrito, mismo pedido), con esas tres diferencias: no tiene stock, cada línea lleva el turno, y el
servicio define si pide destinatario.

## Modelo de datos
Fuente: `prisma/schema.prisma`.

### En el producto
- **`ProductType.SERVICIO`** — se pricea **como un PRODUCTO**: el precio vive en sus
  `ProductVariant` (la default + las que haya). Es lo que permite "baño perro chico $12.000 / grande
  $18.000" sin inventar nada nuevo: son variantes con atributos del catálogo del tenant (ver
  [[Variantes]]).
- **Sin stock.** `resolveProductStock` (`helpers/price.js`) devuelve `null` para SERVICIO, igual que
  para COMBO: nadie valida ni descuenta stock. La columna `ProductVariant.stock` es NOT NULL y queda en
  `0`, sin significado.
- **`Product.serviceRecipient: ServiceRecipient?`** — para quién es el servicio (null en
  PRODUCTO/COMBO):

  | Valor | Qué significa | Destinatario en la línea | Ejemplo |
  | --- | --- | --- | --- |
  | `DIRECTO` | lo recibe quien lo contrata | prohibido (`SERVICE_RECIPIENT_NOT_ALLOWED`) | masaje, corte para uno mismo |
  | `TERCERO` | siempre es para otro | **obligatorio** (`SERVICE_RECIPIENT_REQUIRED`) | peluquería canina (el perro), catering (la empresa) |
  | `AMBOS` | el cliente elige | opcional; sin nombre = para quien contrata | peluquería: turno para sí o para su hijo |

  Default al crear: `DIRECTO` — no se le pide al cliente nada que el local no haya decidido pedir.
- **`Product.serviceRecipientLabel: String?`** — cómo pregunta el storefront por el destinatario
  ("Nombre del perro", "Empresa"). Solo texto de UI; `null` = el default del front. Aparece también
  en el mensaje de `SERVICE_RECIPIENT_REQUIRED`.

### En la línea (`CartItem` y `OrderItem`)
Las mismas tres columnas en las dos tablas; el checkout las copia del carrito a la orden.

- **`serviceDate: DateTime? @db.Date`** — el día.
- **`serviceTime: String?`** — la hora, `"HH:MM"` 24 h.
- **`serviceRecipientName: String?`** — para quién. `null` = para quien contrató (su nombre ya está
  en `Order.contactName`).

Por qué así:

- **Columnas y no JSON** (a diferencia de `comboSelection`): la próxima pregunta es "¿qué turnos tengo
  el martes?", y eso es un `WHERE serviceDate = ...` (`OrderItem` tiene `@@index([serviceDate])`).
- **Día y hora separados, la hora como texto**: es la hora de reloj del local, no un instante. El
  proyecto no tiene noción de zona horaria por tenant (ver [[Estadísticas]]), y un `DateTime` obligaría
  a decidir una. `@db.Date` no tiene hora, así que tampoco puede correrse de día al serializarse.
- **CHECKs en la migración** (`CartItem_service_booking_check`, `OrderItem_service_booking_check`):
  día y hora van juntos, no hay destinatario sin turno, y la hora respeta `HH:MM`.

Forma pública (request y respuestas): `service: { date: "YYYY-MM-DD", time: "HH:MM", recipientName:
string | null }`. `serviceBookingOf(row)` convierte una fila a esa forma; `null` si la línea no es de
un servicio.

## Reglas de negocio / invariantes
Todas viven en `resolveServiceBooking(product, service, { rejectPast })` (`helpers/service-booking.js`),
la única definición de "¿este turno sirve para este servicio?". La usan el carrito, `priceItems`
(checkout, mostrador, bot) y la revisión.

- **SERVICIO sin turno** → `400 SERVICE_BOOKING_REQUIRED`, en el carrito y en el pedido.
- **Turno en algo que no es SERVICIO** → `400 SERVICE_BOOKING_NOT_ALLOWED` (es un error del front, no
  un dato a ignorar).
- **Destinatario** según `serviceRecipient` (tabla de arriba).
- **Fecha pasada** → `400 SERVICE_DATE_IN_PAST`, **solo en el carrito** (`rejectPast: true`). "Hoy" es
  el día **local** del server, mismo criterio que `dayBoundary` (`schemas/date.schema.js`). El pedido
  no la vuelve a mirar: el mostrador puede estar registrando un turno que ya se hizo, y la revisión de
  un pedido no puede trabarse porque el día pasó.
- **Forma** (`schemas/service.schema.js`): fecha `YYYY-MM-DD` que exista (un `2026-02-30` no pasa),
  hora `HH:MM` 24 h, destinatario ≤ 100 caracteres.
- **Sin stock**: el carrito no chequea stock, `priceItems` tampoco (`stock == null`), y
  `updateOrderStatus` saca las líneas de servicio de `stockLines` al completar — si no, el decremento
  condicional sobre la variante en 0 haría fallar la orden con `INSUFFICIENT_STOCK`.
- **Carrito: una línea por servicio+variante, siempre de cantidad 1.** Volver a agregar el mismo
  servicio **reemplaza el turno** en vez de sumar (mismo criterio que `addCombo` con la selección).
  Ver Deuda técnica.
- **Merge de carrito de invitado**: ante el mismo servicio en los dos carritos gana el turno del
  usuario logueado (mismo criterio que los combos).
- **Revisión** (`POST /orders/:id/review`): cada ítem acepta `service` para **reprogramar** el turno
  completo; sin `service`, se conserva.
- **Combos**: un servicio **no puede** ser componente de un combo (`COMBO_SERVICE_NOT_ALLOWED`): el
  combo no tiene dónde llevar el turno. Lo rechazan la whitelist al guardarse y
  `validateComboSelection` (por si una regla de categoría sin miembros abarca servicios).
- **Promos por cantidad**: solo PRODUCTO (`PROMO_PRODUCT_TYPE_NOT_ALLOWED`).
- **Bot de WhatsApp**: describe los servicios (siempre disponibles) pero no los pide —
  `createDraftOrder` devuelve un mensaje amigable, como con los combos. No sabe tomar un turno.
- **Transiciones de tipo** (`PATCH /products/:id`): PRODUCTO ↔ SERVICIO no toca las variantes (las dos
  formas se pricean igual); pasar a SERVICIO sin `serviceRecipient` lo deja en `DIRECTO`, y dejar de
  ser servicio limpia los dos campos. SERVICIO ↔ COMBO se comporta como PRODUCTO ↔ COMBO. Los campos
  de servicio en un producto que no lo es → `400 SERVICE_FIELDS_NOT_ALLOWED`.

## Endpoints
No hay rutas nuevas: los servicios usan las de [[Productos]], [[Variantes]], [[Carrito]] y
[[Órdenes]]. Lo que cambia:

| Ruta | Cambio |
| --- | --- |
| `POST/PATCH /products` | `type: "SERVICIO"`, `serviceRecipient`, `serviceRecipientLabel`. Alta en 1 paso con `price` solo (sin `stock`) o `variants[]` sin `stock`. |
| `GET /products`, `GET /store/products` | `?type=SERVICIO` = la sección de servicios. |
| `POST /variants/:productId` | `stock` pasa a ser opcional en el schema; un PRODUCTO lo sigue exigiendo (`STOCK_REQUIRED`). |
| `POST /cart/:productId`, `POST /store/cart/:productId` | body `service` (obligatorio para servicios). |
| `GET /cart`, `GET /store/cart` | cada línea trae `service`. |
| `POST /orders` (mostrador) | `items[].service`. |
| `POST /orders/:id/review` | `items[].service` para reprogramar. |
| Respuestas de orden | cada línea de `productos[]` trae `service`. |
| `GET /orders/export` | hoja "Ítems" con columna **Turno** ("05/10/2026 10:30 · Firulais"). |

## Dependencias
- [[Productos]] — el tipo y los campos del servicio.
- [[Variantes]] — el precio (y las opciones de precio) del servicio.
- [[Carrito]] y [[Órdenes]] — el turno viaja por la línea.
- [[Combos]], promos, [[Chat de tienda]] / [[WhatsApp]] — excluyen servicios, cada uno a su manera.
- [[Estadísticas]] y [[Sugerencias de contenido]] — un servicio no tiene stock: no entra en bajo/sin
  stock ni en `LOW_STOCK`.

## Deuda técnica / cosas raras
Etiquetas por tipo de acción — ver convención en [[App]].

- `[riesgo]` **Dos turnos del mismo servicio no entran en un carrito.** El unique
  `(cartId, productId, variantId)` de `CartItem` es por producto, no por turno: dos perros del mismo
  tamaño para el mismo baño son una sola línea, y agregar el segundo reemplaza el turno del primero.
  El pedido (`OrderItem`) sí los admite —no tiene ese unique—, así que el mostrador puede cargarlos.
  Salida: reemplazar el unique por uno parcial `WHERE "serviceDate" IS NULL` y darle a las líneas de
  servicio una baja por id de línea (hoy `PATCH /cart/:productId` busca por producto+variante).
- `[nota]` **Sin agenda ni disponibilidad.** No hay horarios de atención, duración, capacidad ni
  control de superposición: el cliente pide un turno y el local lo confirma o reprograma en la
  revisión (los pedidos STORE ya pasan por ahí). Es deliberado para v1: "qué, cuándo y para quién" es
  lo que hacía falta recaudar.
- `[nota]` `ProductVariant.stock` de un servicio vale 0 y no significa nada. Un servicio que pasa a
  PRODUCTO arranca con ese 0: hay que cargarle stock.
- `[nota]` El front del storefront que oculta productos sin stock tiene que tratar a los servicios
  como siempre disponibles (el backend no filtra por stock; ver la guía de frontend).

## Preguntas abiertas / mejoras candidatas
- **Agenda del local**: `GET /orders/services?from&to` — los turnos del día/semana, agrupados. El
  índice sobre `OrderItem.serviceDate` ya está.
- **Disponibilidad**: horarios de atención por tenant (¿reusar la forma de `cashSchedule`?), duración
  por servicio, cupo por franja, rechazo de turnos superpuestos.
- **Datos extra por servicio** (raza y tamaño del perro, cantidad de invitados de un catering): hoy
  entran en la nota de la línea (`OrderItem.note`) o como variante. Si hace falta estructura, un
  catálogo de campos por servicio, en la línea de `TenantAttribute`.
- **Recordatorio** al cliente el día antes del turno (mail / WhatsApp).
- ¿El bot de WhatsApp debería tomar turnos? Necesita preguntar día, hora y destinatario antes de
  `createDraftOrder`.
