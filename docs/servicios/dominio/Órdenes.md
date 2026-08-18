---
tags: [servicio, dominio/ordenes]
estado: estable
ultima-revision: 2026-07-31
lado: backend
---

# Órdenes

> [!note] `PENDING` → `NEW` y catálogo de estados (2026-07-31)
> El primer estado pasó a llamarse **`NEW`**: es la bandeja de entrada —nadie puede volver ahí y el
> motor la saca sola en cuanto la orden deja de tener blockers—, pero "pendiente" se leía como
> "trabada" y el panel terminaba traduciéndolo a "Nueva" al mostrarlo. La migración
> (`20260731120000_rename_order_status_new`) es un `ALTER TYPE ... RENAME VALUE`: conserva el OID, así
> que no hubo backfill ni cambió el orden del enum.
>
> Y con eso salió a la luz un problema más viejo: **la tabla de estados estaba escrita cinco veces**
> (emails, toasts del panel, etiquetas de estadísticas, y una copia en cada frontend), así que agregar
> `READY` había obligado a tocar cinco archivos. Ahora los nombres viven en
> **`services/order-status.js`** y se sirven por `GET /order-statuses`. Ver "Catálogo de estados".

> [!note] Comprobantes de transferencia (2026-07-30)
> El efectivo no se puede controlar; la transferencia sí, porque deja respaldo bancario. Hasta acá el
> sistema registraba **cuándo** alguien dio una transferencia por confirmada, pero no **qué miró para
> decidirlo**. Ahora se le puede adjuntar el archivo a la orden (`OrderReceipt`, imagen o **PDF**), y
> al confirmar queda enlazado a la fila del libro que respalda. **Subir no confirma**: es evidencia,
> la confirmación la sigue haciendo una persona. Ver "Comprobantes de transferencia".

> [!note] Libro de cobros (2026-07-29)
> El dinero deja de ser un sello y pasa a ser **una fila por cobro** (`OrderPayment`, con vía y
> monto). `Order.paymentStatus` se **deriva** de ese libro; los tres `confirm-*` quedan como atajos
> que calculan un monto y escriben una fila. Con eso se puede responder "cuánto se cobró y por qué
> vía", que es lo que [[Caja]] necesitaba y lo que hacía que el cálculo de saldos fuera indeducible.
> Ver "El libro de cobros".

> [!note] Motor de estados (2026-07-29)
> Las precondiciones para mover una orden salieron de `updateOrderStatus` a **`services/order-state.js`**,
> un módulo puro que declara las transiciones y responde "¿qué le falta a esta orden?". Con eso:
> las respuestas del backoffice traen `blockers`/`canProduce`/`payment`, la orden **entra sola a
> `PROCESSING`** cuando se cumplen sus condiciones (revisión o confirmación de cobro), el historial
> distingue el avance automático (`trigger`) y se sumó el estado **`READY`**. Nada de esto rompe el
> contrato anterior: mismos endpoints, mismos códigos de error, campos agregados y no cambiados.

> [!note] Rediseño de tipos de producto (ver [[Productos]] y [[Combos]])
> `OrderItem` gira alrededor de `productId` (**NOT NULL**, siempre presente); `variantId` es
> **nullable**, `null` solo para líneas de un `COMBO` (un `PRODUCTO` siempre resuelve variante —
> default o explícita). `priceItems()` arranca resolviendo `Product` y branchea por `type`
> (PRODUCTO/COMBO). El detalle está integrado en las secciones de abajo.

> [!note] Entrega y método de pago (2026-07-23)
> Hueco identificado en una reunión con Mesa Dulce: para despachar un pedido hacía falta saber
> **dónde entregarlo** (o si es retiro en local) y **cómo se paga** (efectivo contraentrega,
> transferencia previa revisada a mano, o mixto) — antes de esto, `POST /orders` no aceptaba
> **ningún** dato del cliente más allá del carrito. Se agregaron `fulfillmentMethod`,
> `addressText/Lat/Lng/Details`, `paymentMethod` (reemplaza un `String?` que ya existía en el
> schema pero que ningún código real llegaba a setear) y `paymentNote`, más un endpoint de
> confirmación de transferencia (`confirmTransfer`) calcado del de seña (`confirmDeposit`). El
> bot de WhatsApp **no cambió**: sigue creando órdenes sin estos datos; un admin los completa vía
> `review` antes de producir. ~~Direcciones guardadas por usuario quedaron **fuera de alcance**~~
> — revertido el 2026-07-27: existe [[Direcciones]] (`UserAddress`), pero **la orden sigue sin FK**:
> el checkout copia los campos como snapshot, así que borrar una dirección jamás altera un pedido
> cerrado. Lo que era "fuera de alcance" era el acoplamiento, y eso se mantiene.

> [!note] Checkout sin cuenta (2026-07-28)
> `POST /store/orders` dejó de exigir login, igual que el carrito ([[Carrito]]): la ruta usa
> `optionalStoreAuth` + `resolveCartOwner`, y `OrderModel.create` recibe un `cartOwner`
> (`{ userId } | { guestId }`) en vez de un `userId` suelto — el parámetro viejo queda como atajo
> retrocompatible para la ruta admin y los tests. Consecuencias:
> - La orden de un invitado nace con **`userId: null`** (la columna ya lo admitía por los drafts del
>   bot) y su `OrderStatusHistory` inicial con `changedById: null`.
> - **`contactName` y `contactPhone` pasan a ser obligatorios** para el invitado, y ese requisito
>   **pisa** el `customerPhoneMode` del tenant aunque esté en `off`: sin cuenta, el teléfono es el
>   único dato de contacto que queda. Falta el nombre → `CONTACT_NAME_REQUIRED` (400).
> - El teléfono **no** se guarda en ninguna cuenta (no hay dónde), a diferencia del caso logueado.
> - El **historial sigue siendo de la cuenta**: `GET /store/orders` y `GET /store/orders/:id`
>   conservan `verifyStoreToken`. Un invitado no tiene con qué probar que una orden es suya; lo que
>   ve al confirmar sale de la respuesta del `POST`.
> - El carrito de invitado se busca por `guestId` y **nunca** con `guestId: null` — un carrito de
>   usuario logueado tiene ese campo en null y un `where` así matchearía el carrito de cualquier otro
>   cliente.

> [!note] Checkout completo + pedido por WhatsApp (2026-07-26)
> Continuación directa de lo anterior, para cerrar el flujo real de Mesa Dulce. Tres cosas:
> 1. **El pago mixto ahora tiene montos** (`cashAmount`/`transferAmount`), validados server-side
>    contra el `total` calculado desde el carrito → `PAYMENT_AMOUNTS_MISMATCH` (400). No reemplaza a
>    `paymentNote`, que sigue existiendo como aclaración libre, pero ya no es el único dato.
> 2. **`addressMapsUrl`**: el cliente puede pegar el link que comparte desde su teléfono. Si
>    `fulfillmentMethod = DELIVERY` hace falta **al menos uno** de `addressText` | `addressMapsUrl`
>    (antes `addressText` era obligatorio a secas). Sigue sin haber geocoding: solo se valida el host.
> 3. **Deep-link de WhatsApp**: el 201 del checkout devuelve un bloque `whatsapp` con el pedido ya
>    redactado y una URL `wa.me` al número del tenant. El mensaje lo manda **el cliente desde su
>    propio WhatsApp** — no hay envío server-side ni plantillas de Meta (eso es [[WhatsApp]], el bot
>    *entrante*, otro camino). Ver `lib/whatsapp-link.js`.
>
> Y como consecuencia: **las órdenes del storefront ahora exigen revisión**. Nace `OrderOrigin.STORE`
> y el guard `ORDER_NOT_REVIEWED` pasó de `origin === "BOT"` a `origin !== "ADMIN"`. Ninguna orden
> cargada por un cliente entra a producción sin el OK de un humano.

## Propósito
Convierte el carrito de un usuario en una orden inmutable de ítems con precio congelado, y gestiona
el ciclo de vida de esa orden (preparación, completado, cancelación) con historial auditable y
notificación por email al cliente.

## Modelo de datos
Fuente: `prisma/schema.prisma` (modelos `Order`, `OrderItem`, `OrderStatusHistory`).

- **`Order`** — `tenantId`, `userId` (**nullable**: nacen sin usuario tanto las órdenes del bot como
  las del checkout de invitado, 2026-07-28),
  `status` (`OrderStatus`, default `NEW`), `total`, `paymentStatus` (`PaymentStatus`, default
  `PENDING`), `paymentId`, `mercadoPagoId` (único), `preferenceId`, timestamps.
  - **Procedencia + revisión:** `origin` (`OrderOrigin`, default `ADMIN`), `contactPhone` (wa_id del
    cliente de WhatsApp), `contactName`, `reviewedById`, `reviewedAt`.
  - **Seña / depósito:** `requiresDeposit` (default `false`), `depositAmount` (snapshot pactado al
    crear, **no** se recalcula desde `TenantConfig`), `depositConfirmedById`, `depositConfirmedAt`.
  - **Entrega y pago (2026-07-23):** `fulfillmentMethod` (`FulfillmentMethod?`: `DELIVERY`/`PICKUP`),
    `addressText`/`addressLat`/`addressLng`/`addressDetails`/`addressMapsUrl` (solo relevantes si
    `fulfillmentMethod = DELIVERY`; `addressDetails` es texto libre, ej. "rejas grises", referencia
    para el repartidor; `addressMapsUrl` es el link de Google Maps que pega el cliente —
    2026-07-26), `paymentMethod` (`OrderPaymentMethod?`: `CASH`/`TRANSFER`/`MIXED` — reemplaza el
    `String?` que existía antes y que **nunca seteaba código real**, solo placeholders de seed),
    `cashAmount`/`transferAmount` (desglose del pago mixto, 2026-07-26 — solo si `MIXED`, y su suma
    debe igualar `total`), `paymentNote` (texto libre para aclarar el pago, ej. "transfiere el
    lunes" — el software no gestiona el dinero, es solo información para quien revisa),
    `transferConfirmedById`/`transferConfirmedAt` (confirmación manual de que la transferencia
    llegó, independiente de `paymentStatus`/[[MercadoPago]] y de la seña),
    `paymentConfirmedById`/`paymentConfirmedAt` (2026-07-28 — cobro total dado por bueno a mano,
    ver más abajo). Todos nullable a nivel
    DB — lo "obligatorio si DELIVERY" y lo "obligatorio en la creación" se exige en la capa de
    validación (Zod) y en los guards de transición de estado, no en el schema.
  - **`creationContext`** — snapshot del fragmento de conversación que originó la orden del bot (el
    history vive en Redis con TTL, así que la orden guarda su propio contexto).
- **`OrderItem`** — `orderId`, `productId` (**NOT NULL**, siempre presente), `variantId` (**nullable**,
  `null` solo para líneas COMBO), `quantity`, `price` (**snapshot**:
  se copia al crear la orden y no se recalcula después), `note?` (texto libre por línea, ej. "sin
  nueces"). **Sin unique real**: el viejo `@@unique([orderId, variantId])` fue reemplazado por índices
  no únicos (`[orderId, variantId]`, `[orderId, productId]`, `[parentItemId]`) — una orden puede tener
  dos filas del mismo producto/variante con notas distintas. **Árbol de combos**: `parentItemId?`
  (self-relation `onDelete: Cascade`) — la fila padre es el combo comprado (`productId` = el combo,
  `price` = precio fijo, sin `variantId`), sus `childItems` son los componentes reales elegidos
  (`price: 0`, ahí vive el stock real). Ver [[Combos]].
- **`OrderStatusHistory`** — `orderId`, `fromStatus`, `toStatus`, `note`, `changedById`, `trigger`,
  `createdAt`. Una fila por cada transición (incluida la creación, con `fromStatus = null`).
- **`OrderPayment`** (2026-07-29) — el **libro de cobros**: `orderId`, `kind`
  (`DEPOSIT`/`PAYMENT`/`REFUND`), `channel` (`CASH`/`TRANSFER`/`GATEWAY`), `amount` (siempre
  positivo, `CHECK` en la migración), `note`, `confirmedById`, `confirmedAt`. **Una fila por cobro.**
  Es lo que permite responder "¿cuánto se cobró de esta orden y por qué vía?", que con los sellos
  —banderas con fecha, sin monto— era indeducible. Ver "El libro de cobros" más abajo.
- **`OrderReceipt`** (2026-07-30) — el **comprobante**: `orderId` (NOT NULL), `orderPaymentId`
  (**nullable**, se llena al confirmar), `storageProvider`/`cloudName`/`publicId`/`resourceType`/
  `deliveryType`/`format` (con qué ubicar y firmar el archivo — **no hay columna de URL**, ver
  abajo; `cloudName` es en qué cuenta de Cloudinary quedó, `null` = la global), `mimeType`,
  `bytes`, `originalName`, `note`, `uploadedById`, `deletedAt`/`deletedById` (soft-delete). Ver
  "Comprobantes de transferencia".
- **Enums relacionados** (`prisma/schema.prisma`): `OrderOrigin` = `ADMIN` | `BOT` | `STORE`
  (2026-07-26 — `STORE` marca las órdenes que llegan por `/store/orders`, sujetas al guard de
  revisión igual que las del bot). `PaymentStatus`
  incorpora `DEPOSIT_PAID` y `PAID_IN_FULL` (además de `PENDING`/`APPROVED`/`REJECTED`/`IN_PROCESS`/
  `REFUNDED`) para modelar la seña. `FulfillmentMethod` = `DELIVERY` | `PICKUP`. `OrderPaymentMethod`
  = `CASH` | `TRANSFER` | `MIXED` (distinto de `PaymentStatus`, que es el eje de [[MercadoPago]]).
  `PaymentChannel` = `CASH` | `TRANSFER` | `GATEWAY` — **no confundir con `OrderPaymentMethod`**: uno
  es lo pactado para la orden entera, el otro la vía de UN cobro concreto. Una orden `MIXED` genera
  dos filas de cobro, una `CASH` y una `TRANSFER`; `MIXED` no existe como canal.

> [!note] Scoping por `tenantId`
> Toda lectura/escritura filtra por `tenantId` (`where: { ..., tenantId }` en
> `services/orders.js`). El middleware inyecta `req.tenantId` a partir del subdominio o del header
> `X-Tenant-Slug` (este último sí lo manda el cliente); en rutas con sesión se revalida contra el
> `tenantId` del JWT. No hay scoping automático a nivel de Prisma — cada query de este servicio hace
> el filtro a mano, por convención. Ver [[Multi-tenancy]].

## Reglas de negocio / invariantes

- **El precio se resuelve server-side.** `priceItems()` resuelve `Product` (y su `variant` si es
  PRODUCTO — default o explícita) y llama `getProductPrice(variant, product)`; si no se puede
  resolver un precio, la orden se rechaza con `PRODUCT_NO_PRICE`
  (`helpers/price.js`; [services/orders.js:119-128](services/orders.js#L119-L128)). El cliente nunca
  envía precios.
- **Pricing y stock branchean por `Product.type`.** Para `COMBO`, el ítem no tiene precio/stock
  propio: `priceItems()` valida la `comboSelection` contra la whitelist vía
  `validateComboSelection` (`services/combos.js`) y arma `comboChildren` multiplicando por
  `item.quantity` ([services/orders.js:130-144](services/orders.js#L130-L144)); el chequeo de stock
  de líneas normales se salta para combos, porque corre sobre los componentes
  ([services/orders.js:99-117](services/orders.js#L99-L117)).
- **Los combos se insertan como árbol.** `insertOrderItems()` crea primero las filas "padre" (líneas
  normales + una por combo comprado) y, si traen `comboChildren`, sus hijos con `parentItemId` y
  `price: 0` en un segundo `createMany` ([services/orders.js:166-202](services/orders.js#L166-L202)).
- **Creación atómica desde el carrito.** `OrderModel.create` corre dentro de `prisma.$transaction`:
  llama `priceItems` (valida catálogo/stock/precio, ver arriba), crea la orden en `NEW`, inserta
  los ítems, registra el historial inicial y **vacía el carrito** en la misma transacción
  (`services/orders.js:262-326`).
- **Entrega y pago son obligatorios al crear, validados por Zod (no por el schema de Prisma).**
  `orderCreate` (`schemas/order.schema.js`) exige `fulfillmentMethod` + `paymentMethod` en el body de
  `POST /orders` y `POST /store/orders`; si `fulfillmentMethod = DELIVERY`, `addressText` pasa a ser
  obligatorio (`superRefine`), y `addressLat`/`addressLng` deben venir juntos si vienen. El servicio
  (`OrderModel.create`) no reimplementa esta validación — persiste lo que ya llegó validado. Una
  orden creada directamente por el bot (`createDraft`) o vía llamada directa al servicio (tests,
  scripts) puede nacer sin estos campos; el guard de producción (ver "Máquina de estados") es lo que
  los vuelve obligatorios antes de `PROCESSING`/`COMPLETED`, no la creación en sí.
- **Una tienda en modo carta no vende por el storefront** (2026-08-07). Si
  `TenantConfig.storeMode` es `MENU` —restó, cafetería: el catálogo se lee—, `/store/cart` y
  `/store/orders` responden **404 `STORE_MODE_MENU`** (`middleware/storeMode.js`, montado en
  `routes/store/index.js`). 404 y no 403 porque para ese tenant el checkout **no existe**, mismo
  criterio que `CASH_REGISTER_DISABLED`; el flag se lee de la base y no del cache de
  `TenantConfigModel.get`, porque diez minutos de TTL son diez minutos vendiendo después de
  apagar la tienda. `OrderModel.create` repite el chequeo cuando `origin === "STORE"`, con el
  `storeMode` que ya viaja en el `select` de config que se hacía igual: es la llave que cubre a
  la próxima ruta que monte este service sin acordarse del middleware.
  **Lo que sigue funcionando es tan importante como lo que se corta**: el mostrador
  (`POST /orders`, `origin: ADMIN`) y los borradores del bot (`createDraft`) crean órdenes igual.
  En una carta el pedido se cierra por fuera —WhatsApp, mostrador—, y no dejar que el local
  anote esa venta sería romperle la [[Caja]], no protegerlo.
- **Qué métodos se aceptan depende del TENANT** (2026-07-29). Los enums de Zod son los valores
  posibles del sistema; los habilitados salen de `TenantConfig.paymentMethodsEnabled` y
  `fulfillmentMethodsEnabled` (ver [[TenantConfig]] → "Perfiles de flujo de venta"). La validación no
  puede vivir en Zod —no conoce el tenant—, así que la hace `assertMethodEnabled` en dos lugares: en
  `OrderModel.create`, **antes** de abrir la transacción (un método no habilitado corta el checkout
  sin tocar stock ni vaciar el carrito, así el cliente puede corregir y reintentar), y en
  `reviewOrder` sobre el estado *resultante*, que es la otra puerta por la que se elige método —
  típico en las órdenes del bot, que nacen sin ninguno.
  Códigos: 400 `PAYMENT_METHOD_NOT_ENABLED` y 400 `FULFILLMENT_METHOD_NOT_ENABLED`, ambos con
  `details: { pedido, habilitados }` para que el panel pueda decir qué sí se puede. Una lista vacía
  se lee como "todo habilitado", no como "nada": es el comportamiento anterior a que las columnas
  existieran, y evita que una config a medio migrar deje al tenant sin poder vender.
- **La seña del tenant aplica también al checkout web** (2026-07-29). `OrderModel.create` lee
  `depositEnabled`/`depositPercentage` y resuelve `requiresDeposit`/`depositAmount` igual que
  `createDraft`. Antes solo lo hacían el bot y el review, así que una orden de `/store/orders` salía
  con `requiresDeposit: false` aunque el tenant cobrara seña y esquivaba el guard
  `DEPOSIT_NOT_CONFIRMED`. Es un **snapshot** por orden: cambiar el porcentaje después no altera
  pedidos ya tomados.
- **El stock se descuenta solo al pasar a `COMPLETED`**, no al crear la orden. Las líneas con stock
  real son las hojas: para un combo son sus `childItems`, para una línea normal es ella misma. El
  decremento va siempre contra `ProductVariant.stock` de la variante de la línea
  (`decrementLineStock`, `services/orders.js:209-235`).
  > [!note] Decremento condicional atómico (cierra la condición de carrera, no un `[bug]` pendiente)
  > El snapshot de `order.orderItems` leído antes de abrir la transacción solo se usa para saber **qué
  > líneas y qué cantidad** decrementar — nunca para decidir si hay stock suficiente. Esa decisión la
  > toma un único `UPDATE` condicional dentro de la transacción:
  > `tx.productVariant.updateMany({ where: { id: variantId, stock: { gte: quantity } }, data: { stock:
  > { decrement: quantity } } })`. Si `count === 0` (la fila no bajó porque ya no había stock
  > suficiente al momento del UPDATE), se lanza `INSUFFICIENT_STOCK` (409) y la transacción hace
  > rollback. Esto cierra la sobreventa por carrera entre dos `COMPLETED` concurrentes que comparten
  > variante — no hace falta lock pesimista ni `SELECT ... FOR UPDATE` explícito, el `WHERE stock >=
  > quantity` del `UPDATE` ya es atómico a nivel de fila en Postgres.
- **Cada transición queda auditada** en `OrderStatusHistory` con `fromStatus`, `toStatus`, `note`,
  `changedById` y `trigger` (`MANUAL` | `AUTO` | `GATEWAY`, 2026-07-29). El timeline se expone
  en `GET /:id` (`controllers/orders.js:getById`) y marca cada entrada con `automatico`.
- **`status` y `paymentStatus` son ejes independientes**, pero desde 2026-07-29 se hablan: confirmar
  un cobro puede **avanzar solo** el estado logístico si con eso la orden queda sin blockers (ver
  "Avance automático"). El estado de pago (`PaymentStatus`) lo mueve [[MercadoPago]] vía el parámetro
  `extraData` de `updateOrderStatus` (no lo toca el controller de órdenes) **y, a mano, las dos
  acciones admin que sellan cobro**: `confirmDeposit` (→ `DEPOSIT_PAID`) y `confirmPayment`
  (→ `PAID_IN_FULL`, 2026-07-28). Ninguna de las dos mueve `status`.
- **Notificación best-effort.** Tras actualizar el estado se envía un email al cliente
  (`buildOrderStatusEmail` → [[Mailer]]); si falla, se loguea pero **no rompe** la actualización
  (`services/orders.js:553-568`).

## Máquina de estados

Fuente: **`services/order-state.js`** (2026-07-29). Las transiciones y las precondiciones ya no viven
adentro de `updateOrderStatus`: se sacaron a un módulo aparte, **puro**, que responde tres cosas
—¿esta transición es válida?, ¿qué le falta a la orden?, ¿corresponde avanzarla sola?— y que consumen
por igual el servicio, el controller y el avance automático. Enum: `prisma/schema.prisma`
`OrderStatus`.

```
         (creación)
            │
            ▼
        NEW ──────► PROCESSING ──────► READY ──────► COMPLETED   (terminal)
            │               │                │
            └───────────────┴────────────────┴──────────► CANCELLED  (terminal)
```

- **Estados:** `NEW`, `PROCESSING`, `READY`, `COMPLETED`, `CANCELLED`.
- **`READY` (2026-07-29)** es "listo para retirar/enviar": el momento en que se le avisa al cliente,
  que antes quedaba tapado dentro de `PROCESSING`. Es **opcional en el camino** —`PROCESSING →
  COMPLETED` sigue siendo válido—, así que un panel que no lo ofrezca funciona igual que antes. No
  toca stock.
- **Transiciones permitidas:** las declara `ORDER_TRANSITIONS`. Una orden solo **avanza**: cualquier
  destino anterior (incluido volver a `NEW`) se rechaza con `INVALID_STATUS_TRANSITION` (400).
  Si alguien marcó un estado por error, el camino sigue siendo cancelar.
- **Estados terminales:** `COMPLETED` (`ORDER_ALREADY_COMPLETED`, 409) y `CANCELLED`
  (`ORDER_ALREADY_CANCELLED`, 409) no se pueden modificar.
- **No-op:** si el estado destino es igual al actual, devuelve la orden sin cambios y sin registrar
  nada. Es un doble click, no un error.
- **Quién dispara:** la creación (`null → NEW`) la dispara el cliente al hacer checkout o el bot
  al crear un borrador; `NEW → PROCESSING` la puede disparar **el motor** (ver "Avance
  automático"); `READY` y `COMPLETED` los mueve siempre **admin/staff** (`PATCH /:id`), porque son
  hechos físicos que solo una persona conoce.
- **Efecto colateral por destino:** `COMPLETED` re-valida y descuenta stock, **y salda el libro de
  cobros**. El resto no toca ninguna de las dos cosas.
  *(El stock reservado en `NEW`/`PROCESSING`/`READY` no se descuenta hasta `COMPLETED`, y una
  cancelación no lo "libera" porque nunca se descontó.)*

> [!important] Entregar es cobrar (2026-07-29)
> Al pasar a `COMPLETED`, `updateOrderStatus` registra en el libro **lo que falte** para llegar al
> total, repartido por vía (es el mismo `buildSettlementEntries` que usa `confirmPayment`), con la
> nota "Cobro registrado al completar la orden". Si la orden ya estaba saldada no escribe nada, así
> que no hay cobro doble ni se tocan las de MercadoPago.
>
> El motivo: una orden en efectivo llegaba a entregada con el libro **vacío** y `paymentStatus` en
> `NEW` para siempre — nadie estaba obligado a confirmar nada, y esa plata no iba a aparecer en
> el arqueo de [[Caja]]. El supuesto es que en el mostrador entregar y cobrar son
> el mismo acto; si alguien completa una orden que no cobró, se corrige con un `REFUND`.
>
> Desde que [[Caja]] existe, este camino es además **uno de los dos** que anotan un movimiento de
> caja (el otro es `applyPayments`), y con la caja habilitada exige turno abierto: completar una
> orden en efectivo sin caja abierta falla con `CASH_SESSION_NOT_OPEN` y no mueve el estado.

### Blockers: qué le falta a la orden

`evaluateOrder(order)` devuelve `{ payment, blockers, canProduce, nextStatus }`. Los **blockers** son
las mismas precondiciones de siempre, con los mismos códigos, pero ahora se pueden **consultar sin
intentar el cambio**: las respuestas del backoffice traen `blockers` y `canProduce`, así el panel
muestra el botón deshabilitado **con el motivo** en vez de dejar que la persona se coma un 409.

Al pasar a `PROCESSING`/`READY`/`COMPLETED` se exige que la lista esté vacía; el primer blocker es el
que sale como error 409:

| Código | Cuándo |
|---|---|
| `ORDER_NOT_REVIEWED` | `origin !== "ADMIN"` y `reviewedById == null`. Todo lo que carga un cliente (`BOT`, `STORE`) pasa por revisión; las `ADMIN` las carga un humano y ya están validadas de origen |
| `DEPOSIT_NOT_CONFIRMED` | el tenant cobra seña y lo cobrado todavía no llega a `depositAmount` |
| `FULFILLMENT_INCOMPLETE` | falta `fulfillmentMethod` o `paymentMethod`. Cubre sobre todo las órdenes BOT, que nacen sin esto |
| `ADDRESS_MISSING` | `DELIVERY` sin `addressText` **ni** `addressMapsUrl`. Alcanza con uno: hay clientes que solo mandan el link de Maps |
| `TRANSFER_NOT_CONFIRMED` | sin seña y con `paymentMethod` ∈ {`TRANSFER`, `MIXED`}: lo cobrado por transferencia no cubre lo esperado por esa vía. `details.comprobantes` (2026-07-30) trae cuántos comprobantes hay cargados sin revisar |

`CANCELLED` queda libre: siempre se puede cancelar. Si el tenant no usa seña y la orden tiene
entrega/pago completos, no hay ningún blocker → comportamiento idéntico al flujo clásico.

**El requisito de dinero es UNA regla** (`moneyBlocker`, 2026-07-29), no dos guards que se pisan:

- Con seña, **alcanza con la seña cobrada**: se produce contra la seña y el saldo se cobra al
  entregar. Es el trato real del negocio.
- Sin seña y con transferencia (total o parte del mixto), esa parte tiene que estar cobrada.
- En efectivo no se exige nada por adelantado: se paga contraentrega.

> **Cambio de comportamiento.** Antes, una orden con seña *y* transferencia exigía las dos
> confirmaciones, y la segunda terminaba sellando "cobré todo" cuando lo que había entrado era solo
> la seña. Hoy la seña destraba la producción sola.

### Avance automático

`applyAutoAdvance` corre **dentro de la transacción** de toda mutación que pueda cambiar las
condiciones —`reviewOrder`, `confirmDeposit`, `confirmTransfer`, `confirmPayment`— y, si la orden
quedó sin blockers, la pasa de `NEW` a `PROCESSING` sola, con una entrada de historial
`trigger: AUTO`. El aviso al cliente sale igual que en cualquier cambio de estado.

Lo que **no** se automatiza, a propósito:

- **La creación.** Una orden `ADMIN` completa nace `NEW` aunque no le falte nada: cargar un
  pedido en el mostrador no significa ponerse a hacerlo.
- **`READY` y `COMPLETED`.** Nadie más que quien produce sabe cuándo el pedido está listo o
  entregado, y `COMPLETED` además descuenta stock.
- **Retroceder.** El motor nunca revierte un estado ni salta pasos.

## Flujo de seña, entrega y pago / pedidos del bot

> [!note] El diseño implementado **difiere** del TBD anterior
> El TBD histórico preveía un estado `PENDIENTE_SEÑA` **previo** a `NEW`. La implementación real
> **no agregó un estado nuevo**: la orden nace directo en `NEW` y la seña/revisión se modelan con
> **flags + guards** (`origin`, `reviewedById`, `requiresDeposit`, `paymentStatus`) sobre la máquina
> existente. La seña es **opcional por tenant** (`TenantConfig.depositEnabled`, `depositPercentage`).

**Alta del borrador (`OrderModel.createDraft`,
[services/orders.js:811-903](services/orders.js#L811-L903)).** La crea el bot de [[WhatsApp]] vía
la tool `createDraftOrder` (ver [[Chat de tienda]]). El bot solo pasa `items` ya resueltos a
`{ productId, variantId?, quantity, note? }` (mergeados por producto+variante+nota antes de
piecearlos); el server valida catálogo/precio (`priceItems`, **sin** chequeo de stock — es a-pedido),
resuelve `total`, y si `TenantConfig.depositEnabled` setea `requiresDeposit = true` y
`depositAmount = total * depositPercentage/100`. Nace con `origin = "BOT"`, `userId = null` y los
datos de contacto (`contactPhone = wa_id`, `contactName`, `creationContext`). El bot **nunca** toca
`paymentStatus`, `depositAmount` ni `tenantId` — **tampoco** `fulfillmentMethod`/`paymentMethod`/
dirección: nace sin nada de esto (decisión explícita, 2026-07-23 — el bot no cambió al agregar
entrega/pago). **No vende combos**: la tool `createDraftOrder` rechaza explícitamente productos
`type = "COMBO"` (ver [[Chat de tienda]] y [[Combos]]).

**Revisión humana (`reviewOrder` → `POST /:id/review`).** Marca `reviewedById`/`reviewedAt`. Solo sobre órdenes en `NEW`
(`ORDER_NOT_NEW` si no). Permite **corrección inline de cantidades/notas**: si llegan `items`
(`[{ id, quantity, note? }]`, `id` es el `OrderItem.id` — no `variantId`, porque una orden puede
tener dos filas del mismo producto con notas distintas), re-resuelve precio y `total`
**server-side** y, si la orden lleva seña, recalcula `depositAmount`. Para una línea de combo, la
`comboSelection` se reconstruye a partir de sus `childItems` actuales; v1 solo permite reescalar
cantidades vía review, no agregar/quitar componentes del combo. **También acepta, opcionalmente,
`fulfillment`** (`fulfillmentMethod`, `addressText/Lat/Lng/Details`, `paymentMethod`, `paymentNote`)
— es el mecanismo pensado para que un admin **complete** estos datos en una orden BOT (que nace sin
ellos) al revisarla; solo se tocan las claves que vienen (`undefined` no pisa lo existente). No
mueve `paymentStatus`, y `status` solo si la revisión fue lo último que faltaba: ahí el motor la
avanza sola a `PROCESSING` (ver "Avance automático").

**Confirmación de la seña (`confirmDeposit` → `POST /:id/confirm-deposit`).** El
dueño verifica la transferencia "a ojo" y confirma: mueve `paymentStatus → DEPOSIT_PAID` y sella
`depositConfirmedById`/`At`. No mueve `status` por sí misma (sí puede destrabar el avance
automático). Solo opera si `requiresDeposit`
(`DEPOSIT_NOT_REQUIRED`) y `paymentStatus === "PENDING"` (`DEPOSIT_NOT_CONFIRMABLE`), para no pisar
un `APPROVED`/`PAID_IN_FULL` escrito por el webhook de [[MercadoPago]]. Es **independiente** de
`reviewOrder` (la seña suele confirmarse días después).

**Confirmación de la transferencia (`confirmTransfer` → `POST /:id/confirm-transfer`,
2026-07-23).** Mismo patrón que `confirmDeposit`, pero para `paymentMethod ∈ {TRANSFER, MIXED}`: un
asistente revisa a mano que la transferencia llegó y confirma, sellando
`transferConfirmedById`/`At`. No mueve `paymentStatus` — es un eje independiente de la seña y de
[[MercadoPago]] —, y `status` solo vía el avance automático. Rechaza con `TRANSFER_NOT_APPLICABLE` si el
`paymentMethod` de la orden es `CASH`, y con `TRANSFER_ALREADY_CONFIRMED` si ya estaba confirmada.
El software **no gestiona el dinero**: no hay verificación automática, solo el sello de quién/cuándo
revisó. Desde 2026-07-30 puede además quedar el **comprobante** de lo que se miró, adjunto en el
mismo request o enlazado por `receiptIds` (ver "Comprobantes de transferencia") — sigue sin haber
verificación: el archivo es evidencia, no prueba.

**Cobro total (`confirmPayment` → `POST /:id/confirm-payment`, 2026-07-28).** Mueve
`paymentStatus → PAID_IN_FULL` y sella `paymentConfirmedById`/`At`. Es la contraparte manual del
webhook de [[MercadoPago]] para los tenants que cobran en efectivo o por transferencia: hasta acá
**`PAID_IN_FULL` no lo escribía ningún flujo de runtime** (solo los seeds), así que en una tienda sin
MercadoPago el `paymentStatus` se quedaba en `PENDING` para siempre — incluso en órdenes entregadas —
y la columna "Pago" del panel mentía. Solo opera desde `PENDING` o `DEPOSIT_PAID` (una orden con seña
cierra el saldo por acá), nunca pisando un `APPROVED`/`REJECTED`/`REFUNDED` de MercadoPago
(`PAYMENT_NOT_CONFIRMABLE`), y rechaza órdenes canceladas (`ORDER_ALREADY_CANCELLED`). No mueve
`status` por sí misma. Igual que las otras dos confirmaciones, el software no verifica que la plata
haya entrado: solo registra que un humano la dio por cobrada.

Camino típico de una orden del bot con seña y pago por transferencia:
`createDraft (NEW, BOT, requiresDeposit, sin fulfillment/payment)` → `review` (humano valida,
completa `fulfillmentMethod`/`addressText`/`paymentMethod`, opcional corrige cantidades) →
`confirmDeposit` (registra la seña en el libro → paymentStatus = DEPOSIT_PAID) → **la orden pasa
sola a `PROCESSING`**; el saldo se cobra al entregar con `confirmPayment`, y desde `PROCESSING` se
va a `READY`/`COMPLETED` con `PATCH /:id` a mano.

## Catálogo de estados (2026-07-31)

Fuente: **`services/order-status.js`** (módulo puro, sin DB ni red, igual que `order-state.js`).
Es **el único lugar donde un estado tiene nombre**.

Antes la misma tabla estaba escrita cinco veces: el copy de los emails (`lib/mailer.js`), los
mensajes de las respuestas del backoffice (`controllers/orders.js`), las etiquetas de
[[Estadísticas]] (`services/stats/builders.js`), y una copia en el panel y otra en el storefront.
Consecuencia concreta: cuando se agregó `READY` hubo que tocar cinco archivos, el tipo de
`OrderStatusItem` en el front nunca lo incorporó, y el panel arrastraba una traducción mental
("el código dice `PENDING` pero mostralo *Nueva*").

Cada entrada declara:

| Campo | Para qué |
|---|---|
| `position` | Lugar en el pipeline. `null` en `CANCELLED`: es la salida lateral, no un paso |
| `isManual` | Si una persona puede llevar la orden ahí. `NEW` es el único que no |
| `admin` | `label`/`plural` del panel + `message`, que completa "Orden ___ exitosamente" |
| `customer` | Lo que ve el cliente: otro registro a propósito ("Nueva" no le dice nada a él) |
| `email` | Copy del aviso. **Interno**: no sale por HTTP |
| `historyNote` | Nota por defecto de `OrderStatusHistory`. **Interno**: antes la mandaba el panel en cada PATCH, así que el bot y los scripts dejaban el timeline mudo |

**`GET /order-statuses`** (router propio, montado en `app.js`) expone la proyección pública —sin
`email` ni `historyNote`— más las `transitions`, que **no se declaran en el catálogo**: salen de
`ORDER_TRANSITIONS` (`services/order-state.js`), que ya era la fuente de qué se puede mover a dónde.
Con eso el panel arma el pipeline entero sin reescribir ninguna regla.

Es la **única ruta sin auth y sin tenant** del sistema, y es deliberado: no hay adentro un dato de
nadie, es una tabla estática que también tiene que poder leer un invitado mirando el pedido que
acaba de hacer. Responde con `Cache-Control: max-age=3600` — solo cambia con un deploy.

Lo que **no** viaja: los colores. Son clases de Tailwind y tienen que estar escritas literales en
cada front para que el build las conserve; servirlas por HTTP no las haría una sola fuente, las haría
una sola fuente que el compilador no puede ver.

> [!warning] `ORDER_STATUS_CODES` está congelado
> El orden **es** el dato (define el pipeline) y el array se comparte con `services/stats/constants.js`.
> Un `.sort()` de cualquier consumidor lo reordenaría para todo el proceso — pasó en el primer test
> que se escribió del módulo, que dejó `CANCELLED` como primer paso. `Object.freeze` convierte eso en
> un TypeError en vez de un panel mal dibujado.

## El libro de cobros (2026-07-29)

Hasta acá el dinero se registraba como **sellos**: `depositConfirmedAt`, `transferConfirmedAt`,
`paymentConfirmedAt`. Banderas con fecha. Nadie podía responder *cuánto* se cobró de una orden sin
deducirlo, y esa deducción se rompía sola: una orden `MIXED` con la transferencia confirmada y la
seña cobrada no tenía forma de decir qué parte faltaba.

Ahora cada cobro es **una fila** de `OrderPayment`, con vía y monto.

### Invariantes

1. **`amount` siempre positivo** (`CHECK` en la migración). El signo lo aporta `PAYMENT_SIGN[kind]`
   (`services/order-state.js`), donde solo `REFUND` es negativo. Guardar montos con signo invita a
   que alguien escriba −50 en un cobro y nadie se entere hasta que no cierran las cuentas.
2. **`Order.paymentStatus` es un CACHE derivado del libro**, recalculado por `derivePaymentStatus`
   en la misma transacción cada vez que el libro cambia. Se mantiene como columna porque los
   listados (`?status=`) y [[Estadísticas]] filtran por SQL. Nadie lo escribe a mano.
   | Situación | Estado |
   |---|---|
   | cobro `GATEWAY` que cubre el total | `APPROVED` (lo que escribía el webhook) |
   | neto ≥ total | `PAID_IN_FULL` |
   | 0 < neto < total | `DEPOSIT_PAID` |
   | sin cobros y con `preferenceId` | `IN_PROCESS` |
   | sin cobros | `PENDING` |
3. **Se cobra el remanente, nunca el total de nuevo.** `pendingByChannel` resta lo ya registrado de
   lo esperado por cada vía. Es lo que hace que `confirmPayment` sobre una orden con seña anote el
   saldo, y sobre una `MIXED` con la transferencia ya cobrada, solo la parte en efectivo.
4. **La vía no se adivina.** Se deriva del `paymentMethod` cuando no hay ambigüedad; con `MIXED` —o
   con una orden que todavía no tiene método definido, el estado normal de un pedido del bot sin
   revisar— hay que declararla, o sale `PAYMENT_CHANNEL_REQUIRED` (400). Adivinar es lo que después
   hace que un arqueo no cierre y nadie sepa por qué.
5. **El libro viaja con la orden.** `payments` está en el `include` compartido de
   `services/orders.js`, así que el motor trabaja con montos reales en todas partes. Si igual llegara
   sin cargar, `paymentSummary` estima desde los sellos y lo marca con `estimated: true` — es un
   fallback para que una query incompleta no invente blockers, no un modo de operación.

### Los `confirm-*` son atajos sobre el libro

Los tres endpoints siguen existiendo, con sus mismos guards y sellos; lo que cambió es que ahora
**calculan un monto y escriben una fila**:

| Acción | Qué anota |
|---|---|
| `confirmDeposit` | una fila `DEPOSIT` por `depositAmount`. Acepta `channel`; obligatorio si es `MIXED` o la orden no tiene método de pago |
| `confirmTransfer` | una fila `PAYMENT`/`TRANSFER` por **lo que falte** por esa vía. Acepta `amount` para declarar lo que realmente entró — quien confirma está mirando el extracto bancario, el software no |
| `confirmPayment` | las filas que falten para llegar al total, **una por vía**. Acepta `channel` para las órdenes sin método definido |

Todo pasa por `applyPayments`, que en **una sola transacción** anota las filas, recalcula
`paymentStatus` y corre el avance automático. No existe el estado intermedio "cobré pero no lo
registré".

### Lo que el libro habilita

Cada fila de cobro es 1-a-1 con el movimiento de caja de [[Caja]]: el pendiente por vía sale de una
suma, no de una fórmula que hay que mantener sincronizada con las reglas de pago. Eso se concretó el
2026-07-29 — `recordOrderPayments` copia una fila del libro a un movimiento de caja, saltea
`GATEWAY`, y `createManyAndReturn` en los dos caminos de escritura le da el `id` de cada fila para
que un cobro no pueda anotarse dos veces en el arqueo.

## Comprobantes de transferencia (2026-07-30)

`confirmTransfer` sellaba `transferConfirmedAt`/`ById`: **cuándo** y **quién**. Lo que faltaba era
**qué**. Un comprobante bancario es lo único que hace auditable una transferencia después del hecho
— el efectivo no deja rastro, esto sí.

Fuente: `services/order-receipts.js`, `lib/storage/`, modelo `OrderReceipt` en `prisma/schema.prisma`.

### Por qué una tabla aparte

Ni una columna en `Order` ni una en `OrderPayment`:

- **`Order` no alcanza.** Una orden `MIXED`, o una con seña por transferencia más el saldo también
  por transferencia, tiene **dos** comprobantes distintos.
- **`OrderPayment` tampoco.** La fila del libro **no existe hasta que alguien confirma**
  (`applyPayments`), así que no hay dónde alojar el estado "hay comprobante cargado, falta
  confirmar" — que es justo el estado que el panel necesita mostrar. Y agregarle una columna mutable
  a una fila del libro va contra su naturaleza.

Así, el comprobante **nace colgado de la orden** (`orderPaymentId: null`) y **se enlaza a la fila del
libro** cuando un humano confirma usando ese archivo. Desde un movimiento de [[Caja]] se llega al
comprobante sin tocar nada de Caja: `CashMovement.orderPaymentId` → `OrderPayment` →
`OrderReceipt.orderPaymentId`.

### Invariantes

1. **Subir NO confirma.** Los comprobantes se falsifican en dos minutos; la confirmación la sigue
   haciendo una persona que mira la cuenta. Hay además una razón dura: confirmar dispara
   `applyAutoAdvance`, así que auto-confirmar significaría que un archivo puede empujar una orden a
   producción sola — inaceptable el día que el que suba sea el cliente (ver "Preguntas abiertas").
2. **No se guarda ninguna URL usable.** Un comprobante lleva CBU, nombre y a veces el saldo de la
   cuenta. Se persisten `publicId` + `cloudName` + `resourceType`/`deliveryType`/`format`, y la URL
   se **emite firmada y con vencimiento (10 min) en cada respuesta**. Los assets se suben como
   `authenticated`, o sea que la URL pública impredecible que usan las imágenes de catálogo acá no
   existe. Ni `publicId` ni `cloudName` salen **nunca** en una respuesta: con los dos se podría armar
   un link por fuera del backend.
3. **Append-only.** Cada subida es una fila nueva; nada pisa nada. El cliente puede mandar dos
   capturas de la misma transferencia, y pisar la primera destruiría evidencia que quizá ya se usó.
4. **Borrar es de `ADMIN`, y borra de verdad.** Se elimina el archivo del proveedor y la fila queda en
   **soft-delete** (`deletedAt`/`deletedById`). El *hecho* de que hubo un comprobante es inmutable; el
   *dato personal* no tiene por qué serlo. Si el proveedor falla, la fila **no** se marca: así el
   reintento lo vuelve a agarrar, en vez de dejar una orden que dice "acá no hay nada" con el archivo
   vivo del otro lado.
5. **Se acepta PDF**, que es como lo exporta la mayoría de los home banking. Va como `resource_type:
   raw` — entregarlo como `image` depende de una casilla de la cuenta de Cloudinary que viene apagada
   por defecto. Costo: **no hay miniatura**, el panel muestra un link (`isPdf: true` en la respuesta).
   De paso, el PDF pesa ~3× menos que la captura de pantalla del mismo comprobante.
6. **El tipo del archivo se verifica de verdad.** El `mimetype` del multipart lo declara el cliente,
   así que además del filtro por tipo se leen los **magic bytes** (`%PDF-`, `FFD8FF`, …) y se rechaza
   la discrepancia con `INVALID_RECEIPT_TYPE`.

### El puerto de almacenamiento (`lib/storage/`)

Los comprobantes **no** usan `lib/imageManager.js`. Ese sube imágenes públicas de catálogo y está
bien así; esto guarda documentos privados, y la diferencia real no es el proveedor sino el **acceso**.

`lib/storage/index.js` expone tres operaciones —`putFile`, `signedUrl`, `deleteFile`— con un
adaptador de Cloudinary detrás (`lib/storage/cloudinary.js`, único archivo del subsistema que importa
`lib/cloudinary.js`). Mudar a S3/R2 es escribir otro adaptador.

Tres decisiones que parecen detalles y no lo son:

- **`putFile` recibe `tenantId` desde el día uno** y la carpeta es
  `{CLOUDINARY_FOLDER}/tenants/{tenantId}/receipts`, distinta del `{folder}/{entity}` de las
  imágenes. Cuando se implementó [[Cloudinary por tenant]] (2026-07-30) el cambio quedó adentro del
  adaptador, como estaba previsto. La carpeta sigue llevando el tenant porque los que no tienen
  cuenta propia comparten la global, y ahí adentro esa separación es lo único que hay.
- **`cloudName` se persiste con cada comprobante.** Un cliente puede cargar su propia cuenta de
  Cloudinary **después** de haber recibido comprobantes; los viejos se quedan en la global. Firmar
  con la cuenta equivocada no da error: da una URL que 404ea al abrirla, y del otro lado hay un CBU
  que alguien necesita mirar. Por eso `signedUrl`/`deleteFile` resuelven credenciales con
  `credentialsForCloudName(tenantId, cloudName)` y no con la cuenta configurada hoy. Es también el
  motivo por el que `signedUrl` es **async** (el `api_secret` del tenant sale de la DB) y `toPublic`
  en `services/order-receipts.js` lo es con ella.
- **`deleteFile` manda `resource_type` **y** `type`.** `cloudinary.uploader.destroy` asume
  `image`/`upload` si no se los pasás: borrar un PDF (`raw`) o cualquier asset `authenticated` con
  los defaults responde "not found" **sin fallar**, y el archivo se queda. Es el modo de falla que no
  se puede tener en algo que guarda CBUs, y tiene test propio.

### Cuál es el archivo que se espera guardar

Importa para entender el resto: **no es la captura de pantalla del cliente**. Esas suelen mostrar
poco más que un monto y no prueban nada.

El flujo pensado es que el admin entre a la cuenta donde **cobra** (Mercado Pago, el banco), abra el
comprobante del ingreso que le acaba de entrar, **descargue el PDF** y adjunte ese. O sea: el
registro propio del comercio, del lado del que recibe la plata, no la declaración del que la mandó.
Por eso importa aceptar PDF, y por eso el `note` libre sirve para anotar el caso mixto ("el cliente
mandó captura, verificado en MP el 12/03").

Esto refuerza el invariante 1: cuando el admin adjunta, **ya verificó**. El archivo documenta esa
verificación; no la reemplaza.

### Borrado y retención

**El borrado es manual, desde el panel** (`DELETE /orders/:id/receipts/:receiptId`, solo `ADMIN`).
No hay ninguna purga automática corriendo, y es una decisión, no un olvido:

- El almacenamiento **no es un problema del SaaS**: cada cliente de producción usa su propia cuenta
  de Cloudinary (ver [[ARCHITECTURE]] §11), y de todos modos los comprobantes son un ruido
  estadístico al lado de las imágenes de catálogo.
- Y con el flujo de arriba, estos archivos son **el respaldo contable de los cobros del comercio**,
  no datos de terceros acumulados sin motivo. Borrarlos solos a los N meses podría destruir
  documentación que el negocio necesita conservar bastante más tiempo que eso.

Existe igual la herramienta, **sin engancharse a nada**: `OrderReceiptModel.purgeExpired` +
`pnpm receipts:purge` (idempotente, con `--months=N` y `--dry-run`). Está disponible por si algún
cliente pide una política de borrado o si el volumen alguna vez lo justifica. Que la dispare el cron
del host y no un job del proceso sigue el criterio de `services/cash-register-schedule.js`: un job
perdido adentro del server es algo que se puede "no ejecutar" sin que nadie se entere.

> [!important] Hoy nada borra solo
> `RECEIPT_RETENTION_MONTHS = 12` es el **default del script**, no una política que el sistema
> aplique. Si alguna vez se decide una retención real, hay que engancharlo al cron del host **y**
> avisarle al tenant — no asumir que ya pasa.

### El estado intermedio en el panel

No hace falta ninguna columna nueva: el blocker `TRANSFER_NOT_CONFIRMED` que el panel ya renderiza
trae `details.comprobantes`, así puede decir *"hay 1 comprobante sin revisar"* en vez de solo *"falta
confirmar"*. En el listado `/orders/all` va `receiptsCount` para badgear filas — el conteo, no las
filas, para no emitir una URL firmada por archivo en cada listado.

## Checkout del storefront y pedido por WhatsApp (2026-07-26)

Camino completo desde el carrito: el cliente elige **cómo paga** (y, si es mixto, cuánto va por cada
vía), **dónde recibe** (dirección escrita, link de Maps o ambos, más referencias), y confirma.

`POST /store/orders` → `OrderModel.create({ origin: "STORE", ... })`. El `origin` lo marca un
middleware chico en `routes/store/orders.js` (`markStoreOrigin`), porque `OrderController.create` es
compartido con la ruta admin. En una sola transacción: `priceItems` sobre el carrito → validación
del desglose mixto contra el `total` recién calculado → `Order` (`NEW`, `STORE`) → items →
historial → vaciado del carrito.

El **desglose mixto se valida contra el total del server**, nunca contra uno que mande el cliente:
Zod solo garantiza que los dos montos estén y sean > 0 (no conoce el total). La suma se compara con
`roundMoney` y falla con `PAYMENT_AMOUNTS_MISMATCH` (400), que hace rollback de todo — el carrito
sobrevive intacto. `reviewOrder` revalida el mismo invariante sobre el estado **resultante**: si el
admin corrige cantidades y el total cambia, el desglose viejo ya no cierra y hay que mandar los
montos nuevos en el mismo review. Al salir de `MIXED` el desglose se limpia solo.

**Deep-link de WhatsApp** (`lib/whatsapp-link.js`, módulo puro sin red ni DB — mismo espíritu que
`buildOrderStatusEmail` en [[Mailer]]). El 201 trae:

```jsonc
{ "message": "Orden creada exitosamente",
  "order": { "id": 812, "origin": "STORE", ... },
  "whatsapp": { "url": "https://wa.me/5491155551234?text=...", "message": "Hola! ...", "phone": "..." } }
```

- El número sale de `TenantConfig.socialWhatsapp`, con fallback a `contactPhone`, normalizado a
  dígitos (`normalizeWaPhone`). Si ninguno sirve → `whatsapp: null` y la orden se crea igual.
- El armado es **best-effort** dentro de un try/catch en el controller: la orden ya está commiteada,
  un problema con el link no puede tumbar la respuesta.
- El mensaje lista items (con los componentes de cada combo y las notas de línea), total, desglose
  de pago, método de entrega, dirección, link de Maps y referencias. Si no hay `addressMapsUrl` pero
  sí `addressLat`/`addressLng`, deriva `https://maps.google.com/?q=lat,lng` (no lo persiste).
- **No hay envío server-side.** El cliente abre la URL y manda el mensaje desde su propio WhatsApp:
  sin plantillas aprobadas por Meta, sin token del tenant, sin ventana de 24 h. No confundir con
  [[WhatsApp]], que es el bot *entrante* (Graph API) — otro camino, otro módulo.

Del otro lado, un admin ve el mensaje, encuentra la orden ya creada en `NEW` y la revisa
(`POST /orders/:id/review`); si con eso no le queda nada pendiente, la orden entra sola a
`PROCESSING`.

## Archivado: el día lo cierra la caja (2026-08-01)

`services/order-archive.js`. **Archivar es sacar una orden del tablero, no de la base.**

El tablero del backoffice agrupa por estado y no corta por fecha, así que "Entregadas" y
"Canceladas" crecían para siempre: a los pocos días la pantalla dejaba de contestar la única
pregunta que se le hace cada mañana ("¿qué tengo que hacer hoy?").

Tres decisiones:

- **El "día" es el turno de [[Caja]]**, no la medianoche. `CashRegisterSession` ya es un turno
  explícito (apertura → cierre) que existe justamente para no tener que definir "hoy" peleándose con
  las zonas horarias. Un corte de medianoche habría sido una segunda definición de lo mismo, peor.
- **Solo se archiva lo terminal.** `ARCHIVABLE_STATUSES` sale de `TERMINAL_STATUSES`
  (`services/order-state.js`), que a su vez se **deriva** de `ORDER_TRANSITIONS`: archivable =
  estado del que no se sale. Una orden abierta no se esconde nunca, por vieja que sea — esconderla
  es cómo se pierde un pedido, y que se vea vieja en el tablero ES la alarma.
- **No es un estado.** Agregar `ARCHIVED` al enum habría roto el pipeline congelado de
  `ORDER_STATUS_CODES`, los contadores y la distribución de [[Estadísticas]], que asumen que todo
  estado es un paso del flujo. Son tres columnas: `archivedAt`, `archivedById`, `cashSessionId`
  (migración `20260801120000_order_archive`, con un CHECK de completitud del sello).

### Qué lo dispara

`CashRegisterModel.close` y `closeWithoutCount` llaman a `archiveTerminalOrders` **dentro de su
transacción**: si el arqueo se cae, las órdenes no pueden quedar archivadas por un turno que nunca
se cerró. El `at` es el `closedAt` del turno, así que el sello de la orden y el del arqueo dicen la
misma hora.

El `where` **no corta por fecha**, y es a propósito: al cerrar un turno, todo lo terminal que sigue
sin archivar es de ese turno por definición (lo anterior se archivó en el cierre anterior). El
efecto secundario es deseado — el primer cierre después de instalar esto barre de una todo lo
terminal acumulado desde siempre.

**`getStatusCounts` llama a `ensureScheduledSession`** (en try/catch: un problema de caja no puede
tumbar el listado). Ese es el que cierra el turno vencido, y hasta acá solo lo llamaban
`GET /cash-register/current` y el enganche de cobros: sin esto, un local que no entra a la pantalla
de Caja nunca vería limpiarse el tablero. Va en los contadores y no en el listado porque el tablero
pide los contadores una vez por carga y el listado una vez **por columna**.

### Quién filtra y quién no

`buildAdminOrdersWhere` toma `includeArchived` (**false** por defecto):

| Consumidor | `includeArchived` | Por qué |
| --- | --- | --- |
| `getUserOrders` (`/all`) | `false` | El tablero muestra el día en curso |
| `getStatusCounts` (`/counts`) | `false` | Si contara distinto, la columna diría "Entregadas 2" y traería una |
| `getOrdersForExport` (`/export`) | **`true`** | La planilla del día se baja **después** de cerrar, cuando todo lo terminal ya está archivado. Con el default copiado sin pensar, "el Excel de hoy" sale vacío |
| `getOrderById` (`/:id`) | n/a | No filtra: una orden archivada se sigue abriendo entera |

### Dónde se ven después

En [[Caja]]: `GET /cash-register/:id` devuelve `orders` —las que ese turno archivó— y "las órdenes
del martes" es "el turno del martes". No hay pantalla de historial de órdenes propia porque sería un
segundo filtro de fechas sobre el mismo concepto.

La búsqueda es por `Order.cashSessionId` y **no** por `CashMovement.orderId`: el movimiento existe
solo si hubo un cobro por el cajón, así que una cancelada, una de MercadoPago (`GATEWAY` se saltea a
propósito) o una entregada sin cobrar se caerían del historial justo cuando son las que hay que
mirar.

Con el turno **abierto**, en vez de `orders` sirve `ordersToClose` (`summarizeArchivable`):
`{ toArchive, staysOpen, unpaid }`. Es lo que el formulario de cierre muestra antes de firmar —
"3 quedan abiertas" es la última chance de notar un pedido que nunca se marcó entregado. Las
entregadas sin terminar de cobrar **se archivan igual**: retenerlas las dejaría en el tablero para
siempre, que es el problema que esto vino a resolver. Se avisan, no se retienen.

### Tenant sin caja

No se archiva nada. El archivado es una función de la caja (`TenantConfig.cashRegisterEnabled`): sin
turnos no hay cierre, y el tablero se comporta exactamente como antes de esta feature.

## Endpoints

### Backoffice — `routes/orders.js` (montado en `/orders`, auth `verifyToken`)

| Método | Ruta | Qué hace | Auth / rol |
| --- | --- | --- | --- |
| POST | `/` | Crea una orden **desde el carrito del usuario o desde las líneas que venga en `items`** (ver "Dos fuentes de líneas"). Body **obligatorio** (`orderCreate`): `fulfillmentMethod` (`DELIVERY`/`PICKUP`) + `paymentMethod` (`CASH`/`TRANSFER`/`MIXED`); si `DELIVERY`, al menos uno de `addressText`\|`addressMapsUrl`; si `MIXED`, `cashAmount`+`transferAmount` (deben sumar el total); `addressLat`/`addressLng`/`addressDetails`/`paymentNote` opcionales. **Opcional**: `items` (`[{ productId, variantId?, quantity, note?, comboSelection? }]`, mínimo 1), que es como carga el mostrador. Por esta ruta la orden queda `origin = ADMIN` | Usuario autenticado |
| GET | `/` | Lista las órdenes **del propio usuario** (filtros `status`, `limit`, `offset`) | Usuario autenticado |
| GET | `/all` | Lista **todas** las órdenes del tenant (filtro `search` por usuario/producto). **Sin las archivadas** (ver "Archivado") | `ADMIN` / `STAFF` |
| GET | `/counts` | Cuántas órdenes hay **por estado** (`{ counts: { NEW: 3, … } }`), con todos los códigos presentes aunque estén en cero. Respeta el mismo `search` que `/all` — comparten el `where` (`buildAdminOrdersWhere`). Son los encabezados del tablero del admin, que pagina por columna y por lo tanto no puede sacar el total contando lo que trajo (2026-07-31). Cuenta **sin las archivadas**, igual que `/all`, y de paso hace rodar el turno de caja (2026-08-01, ver "Archivado"). Declarada **antes** de `/:id`, si no se la come la ruta de detalle | `ADMIN` / `STAFF` |
| GET | `/:id` | Detalle de una orden con `timeline` de estados. `ADMIN`/`STAFF` ven **cualquier orden del tenant** (`getOrderById`, incluidas las BOT con `userId: null`); el resto solo la propia (`getUserOrderById`) — rama por rol en `controllers/orders.js:getById` | Usuario autenticado |
| PATCH | `/:id` | Cambia el `status` (con `note` opcional). Solo hacia adelante; `READY` incluido | `ADMIN` / `STAFF` |
| POST | `/:id/review` | Marca un pedido (BOT) como revisado; corrección inline opcional de cantidades, y opcionalmente completa/corrige entrega y pago (`orderReview`) | `ADMIN` / `STAFF` |
| POST | `/:id/confirm-deposit` | Confirma la seña → `paymentStatus = DEPOSIT_PAID` (`orderConfirmDeposit`) | `ADMIN` / `STAFF` |
| POST | `/:id/confirm-transfer` | Confirma que la transferencia llegó → sella `transferConfirmedById`/`At` (`orderConfirmTransfer`, 2026-07-23). Desde 2026-07-30 acepta **multipart** con el comprobante en el campo `receipt` (y/o `receiptIds` de los ya cargados): se enlazan a la fila del libro que genera. Con JSON puro funciona igual que antes | `ADMIN` / `STAFF` |
| POST | `/:id/confirm-payment` | Da por cobrado el total: anota en el libro lo que falte, por vía, y sella `paymentConfirmedById`/`At`. Body opcional `channel` (`orderConfirmPayment`, 2026-07-28) | `ADMIN` / `STAFF` |
| POST | `/:id/payments` | Registra un cobro o una devolución en el libro: `{ kind, channel, amount, note? }` (`orderPaymentCreate`, 2026-07-29). Es la vía general — sirve para un pago parcial a cuenta o una devolución, que no encajan en ningún `confirm-*`. `channel: GATEWAY` no se acepta: esas filas las escribe el webhook | `ADMIN` / `STAFF` |
| GET | `/:id/payments` | Libro de la orden + resumen (`payment`) + cuánto falta por vía (`pending`) | `ADMIN` / `STAFF` |
| POST | `/:id/receipts` | Adjunta un comprobante (multipart, campo `receipt`: JPG/PNG/WEBP/AVIF/PDF, ≤10 MB, `note` opcional). **No confirma nada** (`orderReceiptCreate`, 2026-07-30) | `ADMIN` / `STAFF` |
| GET | `/:id/receipts` | Comprobantes vivos de la orden, cada uno con una **URL firmada recién emitida** (vence a los 10 min) | `ADMIN` / `STAFF` |
| DELETE | `/:id/receipts/:receiptId` | Borra el archivo del proveedor y marca la fila (soft-delete) → 204 | **`ADMIN`** |

> Las cuatro acciones de la mitad de abajo (review + las tres confirmaciones) pueden dejar la orden
> **ya en `PROCESSING`**: si con esa acción se resolvió el último blocker, el motor la avanza en la
> misma transacción. Las respuestas del backoffice traen `blockers`, `canProduce` y `payment` para
> que el panel sepa qué falta sin tener que intentar la transición.

### Storefront — `routes/store/orders.js`

| Método | Ruta | Qué hace | Auth / rol |
| --- | --- | --- | --- |
| POST | `/` | Crea una orden **siempre desde el carrito**. Mismo body obligatorio que el backoffice (`orderCreate`), pero la orden queda `origin = STORE` (→ necesita `review` antes de producir) y el 201 incluye el bloque `whatsapp` con el deep-link del pedido. **`items` se rechaza acá** (`400 ITEMS_NOT_ALLOWED`): el schema es compartido y lo acepta, pero el middleware `rejectExplicitItems` corta antes de resolver el carrito. No se descarta en silencio a propósito — ver abajo | **Sin login** (`optionalStoreAuth` + `resolveCartOwner`); el invitado debe mandar `contactName` + `contactPhone` |
| GET | `/` | Lista las órdenes del cliente | Cliente del store (`verifyStoreToken`) |
| GET | `/:id` | Detalle de una orden del cliente | Cliente del store (`verifyStoreToken`) |

### Dos fuentes de líneas, un solo precio

`OrderModel.create` acepta las líneas de dos lados y **el precio lo resuelve el server en los dos
casos**, con el mismo `priceItems` (variante, promo o precio fijo del combo). Por `items` viajan qué
y cuántos, nunca cuánto sale: una venta cargada a mano no puede cobrarse a un precio que no está en
el catálogo.

| | Carrito | `items` explícitos |
| --- | --- | --- |
| Quién la usa | checkout de la tienda y del backoffice | el **mostrador** (`POST /orders`) |
| Carrito | se lee y se vacía al crear la orden | **ni se busca ni se vacía** |
| Vacío | `400 EMPTY_CART` si no hay líneas | Zod rechaza `items: []` |
| Precio y total | `priceItems` | `priceItems` |

Que `items` lo honre solo la ruta de admin es deliberado: por `/store/orders` el pedido tiene que
salir del carrito, que es lo único que el cliente pudo llenar pasando por las validaciones de
`cart.add`.

Y ahí se **rechaza**, no se ignora: `rejectExplicitItems` (`routes/store/orders.js`) devuelve
`400 ITEMS_NOT_ALLOWED` sin tocar el carrito ni crear nada. Un 201 que tiró a la basura media
petición es indistinguible de uno que hizo lo que le pidieron, y el error recién aparecería como
"la orden no tiene lo que mandé", lejos de la línea que lo causó. El corte por `origin` del
controller sigue estando abajo como segunda llave: es código compartido y la próxima ruta que lo
monte puede olvidarse del filtro. Cubierto por `tests/orders-counter-items.test.js`.

Validación de payload: `schemas/order.schema.js` (`orderCreate`, `orderStatus`, `orderReview`,
`orderConfirmDeposit`, `orderConfirmTransfer`, `orderConfirmPayment`, `orderReceiptCreate`,
`orderReceiptParams`, `orderQuery`); `note` ≤ 500
chars, `limit` ≤ 100. Ver
[[Usuarios y Auth]] para los dos esquemas de token.

## Dependencias
- [[Carrito]] — origen de los ítems; `create` lee y vacía el carrito. Desde 2026-07-28 comparte con
  él la resolución de dueño (`resolveCartOwner` → `{ userId } | { guestId }`).
- [[Direcciones]] — **acoplamiento deliberadamente nulo**: la libreta es del cliente y el checkout
  copia los campos a las columnas planas de `Order`. No hay FK ni lectura de `UserAddress` desde este
  servicio; quien elige la dirección es el frontend, y lo que manda es un body plano.
- [[Productos]] y [[Variantes]] — validación de disponibilidad, precio y stock.
- [[Perfiles de flujo de venta]] — de dónde salen los métodos de pago/entrega que este servicio acepta
  y si la orden nace con seña. `create` y `reviewOrder` validan contra `TenantConfig`; el motor
  (`order-state.js`) no conoce al tenant, solo los parámetros que ya quedaron en la orden.
- [[Caja]] — **consumidor** del libro de cobros: cada fila que no sea `GATEWAY` se copia a un
  movimiento del turno abierto. La dependencia va en los dos sentidos con la caja habilitada: sin
  turno abierto, `applyPayments` y la liquidación de `updateOrderStatus` lanzan
  `CASH_SESSION_NOT_OPEN` y el cobro no se sella. Con el flag apagado —todos los tenants hoy— no
  corre nada.
- [[MercadoPago]] — mueve `paymentStatus`/`paymentId` vía `extraData` de `updateOrderStatus`;
  independiente de `paymentMethod`/`confirmTransfer` (ver Deuda técnica).
- [[Mailer]] — email de cambio de estado (best-effort).
- [[Cloudinary por tenant]] — dónde aterrizan los comprobantes y por qué `OrderReceipt` guarda
  `cloudName`.
- [[Multi-tenancy]] — scoping por `tenantId`.
- **Sin dependencia de geolocalización externa**: `addressLat`/`addressLng`/`addressMapsUrl` se
  guardan tal cual los manda el cliente. No hay geocoding, ni resolución de links cortos, ni llamada
  a ninguna API de Google: de `addressMapsUrl` solo se valida el **host** (decisión de scope — el
  software no valida ni resuelve la dirección, solo la persiste y la muestra).
- **WhatsApp saliente sin integración**: el deep-link `wa.me` es una URL armada localmente
  (`lib/whatsapp-link.js`), no una llamada a la Graph API. Este servicio no depende de [[WhatsApp]].

## Integraciones externas
- **Email** vía [[Mailer]] (`buildOrderStatusEmail` + `sendMail`). El comportamiento de envío real vs.
  mock depende de la config del mailer (ver su doc).
- No hay otras integraciones externas directas en este servicio (el pago vive en [[MercadoPago]]).

## Deuda técnica / cosas raras
Etiquetas por tipo de acción — ver convención en [[App]].

- `[riesgo]` **`extraData` de `updateOrderStatus` sin validar por schema**: canal genérico para que
  [[MercadoPago]] inyecte campos de pago; confía en el caller. Acción = endurecer la entrada.
- `[riesgo]` **`GET /` (backoffice) devuelve las órdenes del propio usuario, no las del tenant** (el
  listado de tenant es `/all`). Nombre ambiguo (`OrderController.getAll` vs `getUserOrders`), fácil de
  malinterpretar por un consumidor. Acción = renombrar/clarificar.
- `[nota]` **`paymentId` / `preferenceId`** existen en `Order` pero ningún flujo de *órdenes* los
  setea: son propiedad de [[MercadoPago]]. `paymentMethod`, en cambio, **sí** lo setea la creación
  de la orden desde 2026-07-23 (corregido de una nota anterior que decía lo contrario, cuando el
  campo era un `String?` sin uso real). Informativo, no accionable acá.
- `[nota]` **El pago mixto sí tiene desglose desde 2026-07-26** (`cashAmount`/`transferAmount`,
  validados contra el total). Revierte la decisión del 2026-07-23 de dejarlo en texto libre: la
  contra era "el software no gestiona el dinero", pero sin los montos el admin tenía que interpretar
  a mano cada pedido mixto. `paymentNote` queda como aclaración libre, no como el dato. Lo que sigue
  sin existir es la **reconciliación**: nadie verifica que la plata haya entrado, eso lo sella un
  humano con `confirmTransfer`.
- `[nota]` **Las direcciones de la orden son un snapshot, no una referencia**: `addressText`/`Lat`/
  `Lng`/`Details`/`MapsUrl` viven en la orden y **no** apuntan a la libreta ([[Direcciones]],
  `UserAddress`, 2026-07-27). Es intencional: borrar o editar una dirección guardada no puede
  alterar un pedido ya cerrado. Deroga la nota anterior ("no hay direcciones guardadas por usuario"),
  que quedó vieja al implementarse la libreta.
- ~~`[riesgo]` **`OrderModel.create` ignora la seña**~~ **Resuelto** (2026-07-29). Las órdenes del
  storefront salían con `requiresDeposit: false` aunque el tenant cobrara seña, y esquivaban el guard
  `DEPOSIT_NOT_CONFIRMED`; solo `createDraft` (bot) y `reviewOrder` calculaban `depositAmount`. Hoy
  `OrderModel.create` trae `depositEnabled`/`depositPercentage` en el mismo `select` que ya pedía el
  teléfono y resuelve `requiresDeposit` igual que los otros dos caminos (`services/orders.js`). Salió
  junto con los perfiles de flujo de venta, que obligaban a leer esa config ahí mismo. Esta entrada
  quedó abierta un par de semanas después de estar arreglada: `ARCHITECTURE.md` §11 sí lo tenía
  tachado.
- `[nota]` **Los comprobantes de un tenant pueden quedar repartidos en dos cuentas de Cloudinary**
  (2026-07-30, ver [[Cloudinary por tenant]]). Si el cliente carga su cuenta propia después de haber
  recibido comprobantes, los viejos se quedan en la cuenta de la plataforma. Está resuelto —
  `cloudName` dice dónde está cada uno y `signedUrl`/`deleteFile` resuelven credenciales con eso—
  pero conviene saberlo antes de mirar el dashboard de Cloudinary y no encontrar la mitad de los
  archivos. Se termina de cerrar cuando se haga la migración de assets.
- `[nota]` **Subir un comprobante puede fallar con `409 CLOUDINARY_NOT_CONFIGURED`**: pasa cuando el
  tenant no tiene cuenta de Cloudinary propia **y** el deploy tampoco tiene cuenta de plataforma en
  el `.env` (las tres variables son opcionales desde 2026-07-30). Es intencional y no un bug: sin
  ninguna de las dos no hay dónde subir, y degradar significaría dejar archivos con CBU en una cuenta
  que no es de nadie en particular.
- `[nota]` **Retiro en local no tiene ubicación propia**: `fulfillmentMethod = PICKUP` no referencia
  ninguna dirección — se asume que el cliente retira en la única dirección de
  `TenantConfig.contactAddress`. Si un tenant tuviera más de un local, este modelo no alcanza.

## Preguntas abiertas / mejoras candidatas
- ¿Debería una cancelación "devolver" stock? Hoy no aplica porque el stock solo se descuenta en
  `COMPLETED`, pero si esa regla cambia habría que revisarlo.
- El flujo de seña/producción-a-pedido **ya está implementado** (ver "Flujo de seña, entrega y pago
  / pedidos del bot"), resuelto con flags + guards en vez de un estado `PENDIENTE_SEÑA`. ¿Conviene
  igualmente un estado explícito para visibilizarlo en el timeline, o los flags alcanzan?
  *(2026-07-29: los `blockers` de `evaluateOrder` cubren buena parte de la visibilidad que motivaba
  la pregunta — el panel ya puede decir "esperando la seña" sin un estado nuevo.)*
- ~~**Falta el libro de cobros.**~~ **Resuelto** (2026-07-29): existe `OrderPayment`, `paymentStatus`
  se deriva de ahí, y [[Caja]] se implementó ese mismo día encima del libro.
- ~~**`derivePaymentStatus` no traduce las devoluciones.**~~ **Resuelto** (2026-07-29): una
  devolución que cancela todo lo cobrado deriva `REFUNDED`, y se evalúa **antes** que `APPROVED`
  para que una orden cobrada por MercadoPago y devuelta en efectivo no siga viéndose como aprobada.
  `paymentSummary` expone además `charged`/`refunded`, porque `paid` viene neteado y no distingue
  "cobré y devolví" de "nunca cobré". Sigue abierta solo la devolución **parcial**, que se ve como
  `DEPOSIT_PAID` (el enum no tiene `PARTIALLY_REFUNDED`). `registerPayment` rechaza devolver más de
  lo cobrado con `REFUND_EXCEEDS_PAID` (409).
- ¿El cliente del storefront debería poder cancelar su propia orden en `NEW`? Hoy solo
  `ADMIN`/`STAFF` pueden cambiar estado.
- ~~¿Vale la pena una libreta de direcciones guardadas por usuario?~~ **Resuelto** (2026-07-27):
  existe [[Direcciones]], desacoplada de la orden.
- ¿Un invitado debería poder consultar su pedido con algún token de un solo uso (link en el mensaje
  de WhatsApp, por ejemplo)? Hoy el historial exige cuenta y lo único que ve al confirmar es la
  respuesta del `POST`.
- ~~¿Debería el cliente poder subir su propio comprobante?~~ **Decidido que NO** (2026-07-30). El
  comprobante lo carga el administrador y esa es la versión definitiva, no una fase 1 de dos.
  El razonamiento: **el cliente ya manda el comprobante por WhatsApp**, que es un paso que va a dar
  igual. Una pantalla de subida no le ahorra ese paso, le agrega un canal más — el único que se
  ahorraba trabajo era el admin, y entre ahorrarle un paso al cliente y ahorrárselo al admin, gana el
  cliente. A cambio no se construye: un endpoint público que acepta archivos, un esquema de tokens
  firmados por orden con su TTL, y la historia de abuso que hace falta para que no lo usen de
  almacenamiento gratis.
  > No confundir con la pregunta de arriba: el **token de orden para el invitado** sigue abierta por
  > sus propios méritos (que el cliente pueda *ver* su pedido). Lo que se descarta es que además
  > *suba* algo.
- ¿El bot de WhatsApp debería empezar a recolectar `fulfillmentMethod`/dirección/`paymentMethod`
  durante la conversación? Hoy no lo hace (barrera de seguridad "no toca plata" en
  `services/chat/tools.js`) — un admin completa esto vía `review`.
