---
tags: [servicio, dominio/ordenes]
estado: refactor-pendiente
ultima-revision: 2026-06-20
---

# Órdenes

## Propósito
Convierte el carrito de un usuario en una orden inmutable de ítems con precio congelado, y gestiona
el ciclo de vida de esa orden (preparación, completado, cancelación) con historial auditable y
notificación por email al cliente.

## Modelo de datos
Fuente: `prisma/schema.prisma` (modelos `Order`, `OrderItem`, `OrderStatusHistory`).

- **`Order`** — `tenantId`, `userId`, `status` (`OrderStatus`, default `PENDING`), `total`,
  `paymentStatus` (`PaymentStatus`, default `PENDING`), `paymentMethod`, `paymentId`,
  `mercadoPagoId` (único), `preferenceId`, timestamps.
- **`OrderItem`** — `orderId`, `variantId`, `quantity`, `price`. **`price` es un snapshot**: se copia
  al crear la orden y no se recalcula después. Único `(orderId, variantId)`.
- **`OrderStatusHistory`** — `orderId`, `fromStatus`, `toStatus`, `note`, `changedById`, `createdAt`.
  Una fila por cada transición (incluida la creación, con `fromStatus = null`).

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
- **Quién dispara:** la creación (`null → PENDING`) la dispara el **cliente** al hacer checkout; el
  resto de transiciones las dispara **admin/staff** (`PATCH /:id`, `requireRole(["ADMIN","STAFF"])`).
  No hay disparador de sistema ni de bot.
- **Efecto colateral por destino:** `COMPLETED` re-valida y descuenta stock. `PROCESSING` y
  `CANCELLED` no tocan stock. *(El stock reservado en `PENDING`/`PROCESSING` no se descuenta hasta
  `COMPLETED` y una cancelación no lo "libera" porque nunca se descontó.)*

> [!todo] TBD: flujo de seña no implementado en el código
> El modelo producción-a-pedido de Desvare (borrador en `PENDIENTE_SEÑA`, transferencia bancaria del
> 50%, confirmación humana desde el admin que avanza la orden) **no existe en este repositorio**. El
> enum `OrderStatus` (`prisma/schema.prisma`) no tiene `PENDIENTE_SEÑA` y `updateOrderStatus` no
> contempla anticipos, transferencias ni porcentajes. Hay **un solo camino**: orden normal.
>
> **Dónde colgaría el segundo camino (diseño previsto, NO en el código — no citar como verdad):**
> `PENDIENTE_SEÑA` sería un estado **previo** a `PENDING`, no una rama de la máquina actual:
> `PENDIENTE_SEÑA → (admin confirma la seña) → PENDING → …`. Disparadores esperados, separando entrada
> y salida:
> - **Entrada** a `PENDIENTE_SEÑA`: la crea el flujo de compra (bot / cliente vía [[WhatsApp]] o
>   [[Chat de tienda]]) al generar el borrador — *no* el admin.
> - **Salida** (`PENDIENTE_SEÑA → PENDING`): la dispara **admin/staff** a mano tras ver la
>   transferencia del 50%.
>
> Esto contrasta con la máquina actual, donde la creación entra directo en `PENDING`. Cuando se
> implemente, reemplazar este bloque por la doc real con citas al código.

## Endpoints

### Backoffice — `routes/orders.js` (montado en `/orders`, auth `verifyToken`)

| Método | Ruta | Qué hace | Auth / rol |
| --- | --- | --- | --- |
| POST | `/` | Crea una orden desde el carrito del usuario | Usuario autenticado |
| GET | `/` | Lista las órdenes **del propio usuario** (filtros `status`, `limit`, `offset`) | Usuario autenticado |
| GET | `/all` | Lista **todas** las órdenes del tenant (filtro `search` por usuario/producto) | `ADMIN` / `STAFF` |
| GET | `/:id` | Detalle de una orden propia, con `timeline` de estados | Usuario autenticado |
| PATCH | `/:id` | Cambia el `status` (con `note` opcional) | `ADMIN` / `STAFF` |

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
Etiquetas por tipo de acción — ver convención en [[_index]].

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
- ¿Falta un estado intermedio para producción-a-pedido (el "flujo de seña" TBD de arriba)?
- ¿El cliente del storefront debería poder cancelar su propia orden en `PENDING`? Hoy solo
  `ADMIN`/`STAFF` pueden cambiar estado.
