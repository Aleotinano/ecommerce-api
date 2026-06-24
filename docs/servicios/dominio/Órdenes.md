---
tags: [servicio, dominio/ordenes]
estado: refactor-pendiente
ultima-revision: 2026-06-24
---

# Órdenes

## Propósito
Convierte el carrito de un usuario en una orden inmutable de ítems con precio congelado, y gestiona
el ciclo de vida de esa orden (preparación, completado, cancelación) con historial auditable y
notificación por email al cliente.

## Modelo de datos
Fuente: `prisma/schema.prisma` (modelos `Order`, `OrderItem`, `OrderStatusHistory`).

- **`Order`** — `tenantId`, `userId` (**ahora nullable**: las órdenes del bot nacen sin usuario),
  `status` (`OrderStatus`, default `PENDING`), `total`, `paymentStatus` (`PaymentStatus`, default
  `PENDING`), `paymentMethod`, `paymentId`, `mercadoPagoId` (único), `preferenceId`, timestamps.
  - **Procedencia + revisión:** `origin` (`OrderOrigin`, default `ADMIN`), `contactPhone` (wa_id del
    cliente de WhatsApp), `contactName`, `reviewedById`, `reviewedAt`.
  - **Seña / depósito:** `requiresDeposit` (default `false`), `depositAmount` (snapshot pactado al
    crear, **no** se recalcula desde `TenantConfig`), `depositConfirmedById`, `depositConfirmedAt`.
  - **`creationContext`** — snapshot del fragmento de conversación que originó la orden del bot (el
    history vive en Redis con TTL, así que la orden guarda su propio contexto).
- **`OrderItem`** — `orderId`, `variantId`, `quantity`, `price`. **`price` es un snapshot**: se copia
  al crear la orden y no se recalcula después. Único `(orderId, variantId)`.
- **`OrderStatusHistory`** — `orderId`, `fromStatus`, `toStatus`, `note`, `changedById`, `createdAt`.
  Una fila por cada transición (incluida la creación, con `fromStatus = null`).
- **Enums relacionados** (`prisma/schema.prisma`): `OrderOrigin` = `ADMIN` | `BOT`. `PaymentStatus`
  incorpora `DEPOSIT_PAID` y `PAID_IN_FULL` (además de `PENDING`/`APPROVED`/`REJECTED`/`IN_PROCESS`/
  `REFUNDED`) para modelar la seña.

> [!note] Scoping por `tenantId`
> Toda lectura/escritura filtra por `tenantId` (`where: { ..., tenantId }` en
> `services/orders.js`). El `tenantId` lo inyecta el middleware (`req.tenantId`), **nunca llega del
> cliente**. Ver [[Multi-tenancy]].

## Reglas de negocio / invariantes

- **El precio se resuelve server-side.** `getProductPrice(variant, product)` toma `variant.price` y
  cae a `product.price`; si ambos son `null`, la orden se rechaza con `PRODUCT_NO_PRICE`
  (`helpers/price.js`; `services/orders.js:OrderModel.create`,
  [services/orders.js:93-106](services/orders.js#L93-L106)). El cliente nunca envía precios.
- **Creación atómica desde el carrito.** `OrderModel.create` corre dentro de `prisma.$transaction`:
  valida que el carrito no esté vacío (`EMPTY_CART`), que cada variante exista
  (`VARIANT_NOT_FOUND`), esté activa (`VARIANT_NOT_AVAILABLE`), que el producto esté activo
  (`PRODUCT_NOT_AVAILABLE`) y que haya stock suficiente (`INSUFFICIENT_STOCK`), crea la orden en
  `PENDING`, registra el historial inicial y **vacía el carrito** en la misma transacción
  ([services/orders.js:42-141](services/orders.js#L42-L141)).
- **El stock se descuenta solo al pasar a `COMPLETED`**, no al crear la orden. Antes de descontar
  se re-valida el stock de cada ítem dentro de la transacción; si falta, lanza `INSUFFICIENT_STOCK`
  y aborta ([services/orders.js:273-304](services/orders.js#L273-L304)).
  > [!warning] El chequeo y el decremento usan el snapshot de `order.orderItems` leído **antes** de
  > abrir la transacción ([services/orders.js:220-227](services/orders.js#L220-L227)). Dos
  > completados concurrentes de órdenes que comparten variante podrían pasar ambos el chequeo. No hay
  > lock pesimista sobre el stock.
- **Cada transición queda auditada** en `OrderStatusHistory` con `fromStatus`, `toStatus`, `note` y
  `changedById` ([services/orders.js:261-270](services/orders.js#L261-L270)). El timeline se expone
  en `GET /:id` (`controllers/orders.js:getById`).
- **`status` y `paymentStatus` son ejes independientes.** El estado logístico (`OrderStatus`) lo
  mueve el admin/staff; el estado de pago (`PaymentStatus`) lo mueve [[MercadoPago]] vía el parámetro
  `extraData` de `updateOrderStatus` (no lo toca el controller de órdenes).
- **Notificación best-effort.** Tras actualizar el estado se envía un email al cliente
  (`buildOrderStatusEmail` → [[Mailer]]); si falla, se loguea pero **no rompe** la actualización
  ([services/orders.js:311-326](services/orders.js#L311-L326)).

## Máquina de estados
Fuente: `services/orders.js:OrderModel.updateOrderStatus`
([services/orders.js:212-329](services/orders.js#L212-L329)). Enum: `prisma/schema.prisma`
`OrderStatus`.

```
         (creación)
            │
            ▼
        PENDING ──────► PROCESSING ──────► COMPLETED   (terminal)
            │               │
            └───────┬───────┘
                    ▼
                CANCELLED   (terminal)
```

- **Estados:** `PENDING`, `PROCESSING`, `COMPLETED`, `CANCELLED`.
- **Transiciones permitidas:** solo a `PROCESSING`, `COMPLETED` o `CANCELLED`. Cualquier otro destino
  (incluido volver a `PENDING`) se rechaza con `INVALID_STATUS_TRANSITION` (400)
  ([services/orders.js:253-259](services/orders.js#L253-L259)).
- **Estados terminales:** `COMPLETED` (`ORDER_ALREADY_COMPLETED`, 409) y `CANCELLED`
  (`ORDER_ALREADY_CANCELLED`, 409) no se pueden modificar
  ([services/orders.js:233-247](services/orders.js#L233-L247)).
- **No-op:** si el estado destino es igual al actual, devuelve la orden sin cambios
  ([services/orders.js:249-251](services/orders.js#L249-L251)).
- **Quién dispara:** la creación (`null → PENDING`) la dispara el **cliente** al hacer checkout o el
  **bot** al crear un borrador (`createDraft`, ver abajo); el resto de transiciones las dispara
  **admin/staff** (`PATCH /:id`, `requireRole(["ADMIN","STAFF"])`). No hay disparador de sistema.
- **Efecto colateral por destino:** `COMPLETED` re-valida y descuenta stock. `PROCESSING` y
  `CANCELLED` no tocan stock. *(El stock reservado en `PENDING`/`PROCESSING` no se descuenta hasta
  `COMPLETED` y una cancelación no lo "libera" porque nunca se descontó.)*
- **Guards de "bueno para producir" (al pasar a `PROCESSING` o `COMPLETED`)**
  ([services/orders.js:285-309](services/orders.js#L285-L309)):
  - Si `origin === "BOT"` y `reviewedById == null` → `ORDER_NOT_REVIEWED` (409). Un humano debe
    revisar primero.
  - Si `requiresDeposit` y `paymentStatus` ∉ {`DEPOSIT_PAID`, `PAID_IN_FULL`, `APPROVED`} →
    `DEPOSIT_NOT_CONFIRMED` (409). La seña debe estar confirmada.
  - `CANCELLED` queda libre (siempre se puede cancelar). Si el tenant no usa seña y la orden es
    `ADMIN`, ningún guard aplica → comportamiento idéntico al flujo clásico.

## Flujo de seña / pedidos del bot

> [!note] El diseño implementado **difiere** del TBD anterior
> El TBD histórico preveía un estado `PENDIENTE_SEÑA` **previo** a `PENDING`. La implementación real
> **no agregó un estado nuevo**: la orden nace directo en `PENDING` y la seña/revisión se modelan con
> **flags + guards** (`origin`, `reviewedById`, `requiresDeposit`, `paymentStatus`) sobre la máquina
> existente. La seña es **opcional por tenant** (`TenantConfig.depositEnabled`, `depositPercentage`).

**Alta del borrador (`OrderModel.createDraft`,
[services/orders.js:533](services/orders.js#L533)).** La crea el bot de [[WhatsApp]] vía la tool
`createDraftOrder` (ver [[Chat de tienda]]). El bot solo pasa `items` ya resueltos a
`{ variantId, quantity }`; el server valida catálogo/precio (`priceItems`, **sin** chequeo de stock —
es a-pedido), resuelve `total`, y si `TenantConfig.depositEnabled` setea `requiresDeposit = true` y
`depositAmount = total * depositPercentage/100`. Nace con `origin = "BOT"`, `userId = null` y los
datos de contacto (`contactPhone = wa_id`, `contactName`, `creationContext`). El bot **nunca** toca
`paymentStatus`, `depositAmount` ni `tenantId`.

**Revisión humana (`reviewOrder`, [services/orders.js:394](services/orders.js#L394) →
`POST /:id/review`).** Marca `reviewedById`/`reviewedAt`. Solo sobre órdenes en `PENDING`
(`ORDER_NOT_PENDING` si no). Permite **corrección inline de cantidades**: si llegan `items`
(`[{ variantId, quantity }]`, deben pertenecer a la orden), re-resuelve precio y `total`
**server-side** y, si la orden lleva seña, recalcula `depositAmount`. **No** mueve `status` ni
`paymentStatus`.

**Confirmación de la seña (`confirmDeposit`, [services/orders.js:484](services/orders.js#L484) →
`POST /:id/confirm-deposit`).** El dueño verifica la transferencia "a ojo" y confirma: mueve
`paymentStatus → DEPOSIT_PAID` y sella `depositConfirmedById`/`At`. **No** mueve `status`. Solo opera
si `requiresDeposit` (`DEPOSIT_NOT_REQUIRED`) y `paymentStatus === "PENDING"`
(`DEPOSIT_NOT_CONFIRMABLE`), para no pisar un `APPROVED`/`PAID_IN_FULL` escrito por el webhook de
[[MercadoPago]]. Es **independiente** de `reviewOrder` (la seña suele confirmarse días después).

Camino típico de una orden del bot con seña:
`createDraft (PENDING, BOT, requiresDeposit)` → `review` (humano valida, opcional corrige) →
`confirmDeposit` (paymentStatus = DEPOSIT_PAID) → `PATCH /:id` a `PROCESSING`/`COMPLETED` (ya pasa
ambos guards).

## Endpoints

### Backoffice — `routes/orders.js` (montado en `/orders`, auth `verifyToken`)

| Método | Ruta | Qué hace | Auth / rol |
| --- | --- | --- | --- |
| POST | `/` | Crea una orden desde el carrito del usuario | Usuario autenticado |
| GET | `/` | Lista las órdenes **del propio usuario** (filtros `status`, `limit`, `offset`) | Usuario autenticado |
| GET | `/all` | Lista **todas** las órdenes del tenant (filtro `search` por usuario/producto) | `ADMIN` / `STAFF` |
| GET | `/:id` | Detalle de una orden propia, con `timeline` de estados | Usuario autenticado |
| PATCH | `/:id` | Cambia el `status` (con `note` opcional) | `ADMIN` / `STAFF` |
| POST | `/:id/review` | Marca un pedido (BOT) como revisado; corrección inline opcional de cantidades (`orderReview`) | `ADMIN` / `STAFF` |
| POST | `/:id/confirm-deposit` | Confirma la seña → `paymentStatus = DEPOSIT_PAID` (`orderConfirmDeposit`) | `ADMIN` / `STAFF` |

### Storefront — `routes/store/orders.js` (auth `verifyStoreToken`)

| Método | Ruta | Qué hace | Auth / rol |
| --- | --- | --- | --- |
| POST | `/` | Crea una orden desde el carrito | Cliente del store |
| GET | `/` | Lista las órdenes del cliente | Cliente del store |
| GET | `/:id` | Detalle de una orden del cliente | Cliente del store |

Validación de payload: `schemas/order.schema.js` (`orderStatus`, `orderQuery`); `note` ≤ 500 chars,
`limit` ≤ 100. Ver [[Usuarios y Auth]] para los dos esquemas de token.

## Dependencias
- [[Carrito]] — origen de los ítems; `create` lee y vacía el carrito.
- [[Productos]] y [[Variantes]] — validación de disponibilidad, precio y stock.
- [[MercadoPago]] — mueve `paymentStatus`/`paymentId` vía `extraData` de `updateOrderStatus`.
- [[Mailer]] — email de cambio de estado (best-effort).
- [[Multi-tenancy]] — scoping por `tenantId`.

## Integraciones externas
- **Email** vía [[Mailer]] (`buildOrderStatusEmail` + `sendMail`). El comportamiento de envío real vs.
  mock depende de la config del mailer (ver su doc).
- No hay otras integraciones externas directas en este servicio (el pago vive en [[MercadoPago]]).

## Deuda técnica / cosas raras
Etiquetas por tipo de acción — ver convención en [[App]].

- `[bug]` **Decremento de stock sobre snapshot pre-transacción** (ver warning arriba): potencial
  sobreventa bajo concurrencia. Acción = rediseño transaccional (lock / `SELECT ... FOR UPDATE` /
  decremento condicional), no trivial ([services/orders.js:273-304](services/orders.js#L273-L304)).
- `[riesgo]` **`extraData` de `updateOrderStatus` sin validar por schema**: canal genérico para que
  [[MercadoPago]] inyecte campos de pago; confía en el caller. Acción = endurecer la entrada.
- `[riesgo]` **`GET /` (backoffice) devuelve las órdenes del propio usuario, no las del tenant** (el
  listado de tenant es `/all`). Nombre ambiguo (`OrderController.getAll` vs `getUserOrders`), fácil de
  malinterpretar por un consumidor. Acción = renombrar/clarificar.
- `[nota]` **`paymentMethod` / `paymentId` / `preferenceId`** existen en `Order` pero ningún flujo de
  *órdenes* los setea: son propiedad de [[MercadoPago]]. Informativo, no accionable acá.

## Preguntas abiertas / mejoras candidatas
- ¿Conviene un lock/`SELECT ... FOR UPDATE` o decremento condicional al completar, para evitar
  sobreventa?
- ¿Debería una cancelación "devolver" stock? Hoy no aplica porque el stock solo se descuenta en
  `COMPLETED`, pero si esa regla cambia habría que revisarlo.
- El flujo de seña/producción-a-pedido **ya está implementado** (ver "Flujo de seña / pedidos del
  bot"), resuelto con flags + guards en vez de un estado `PENDIENTE_SEÑA`. ¿Conviene igualmente un
  estado explícito para visibilizarlo en el timeline, o los flags alcanzan?
- ¿El cliente del storefront debería poder cancelar su propia orden en `PENDING`? Hoy solo
  `ADMIN`/`STAFF` pueden cambiar estado.
