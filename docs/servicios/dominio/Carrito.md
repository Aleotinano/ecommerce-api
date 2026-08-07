---
tags: [servicio, dominio/carrito]
estado: estable
ultima-revision: 2026-07-22
lado: backend
---

# Carrito

## Propósito
Carrito por `userId` (usuario logueado) **o** por `guestId` (cookie de invitado, sin login — ver
`middleware/guestCart.js`), mutuamente excluyentes. Ítems identificados por
`productId` + `variantId` (este último `null` solo para líneas COMBO). Lo consume y vacía [[Órdenes]]
al crear la orden desde el carrito — el checkout exige estar logueado (ver "Carrito de invitado"
abajo).

## Modelo de datos
Fuente: `prisma/schema.prisma` (modelos `Cart`, `CartItem`).

- **`Cart`** — `tenantId`, `userId?` (único, nullable), `guestId?` (nullable, `@@unique([tenantId,
  guestId])` — el mismo browser puede tener carritos de invitado en tenants distintos), `items:
  CartItem[]`. Un `CHECK` constraint (documentado en comentario del schema junto a `Cart`) exige
  `userId` XOR `guestId`: nunca ambos, nunca ninguno.
- **`CartItem`** — `cartId`, `productId` (**siempre presente**), `variantId?` (**null solo para
  COMBO** — un PRODUCTO siempre resuelve su variante, default o explícita, ver [[Productos]]),
  `quantity`, `comboSelection?` (Json, solo si el producto es COMBO, ver [[Combos]]).
- **`@@unique([cartId, productId, variantId])`** cubre el caso con variante (dos variantes del mismo
  producto son líneas distintas — ej. remera roja y azul). Para COMBO (`variantId: null`), SQL
  no colisiona NULL contra NULL con un unique normal — el caso está cubierto por un **índice único
  parcial** agregado a mano en `prisma/migrations/20260708190000_product_types_add/migration.sql`
  (`WHERE variantId IS NULL`), no declarado en `schema.prisma` a propósito. `CartModel.add`/`addCombo`
  además hacen un `findFirst` antes del create/update dentro de la transacción, para devolver un error
  de negocio legible en vez de que reviente el índice crudo.

## Reglas de negocio / invariantes
- **`CartModel.add({ tenantId, userId, guestId, productId, variantId? })`**: `userId`/`guestId` son
  mutuamente excluyentes, resuelven a qué `Cart` pertenece la línea (ver "Carrito de invitado" abajo).
  Para PRODUCTO, si no viene `variantId` se resuelve la variante **default**
  (`resolveVariantForProduct`); `400 VARIANT_REQUIRED` solo si el producto no tiene ninguna variante
  activa todavía (alta en 2 pasos). Prohibido para COMBO (`400 PRODUCT_IS_COMBO` — usar `addCombo`).
  Chequea stock vía `helpers/price.js:resolveProductStock` antes de incrementar.
- **`CartModel.addCombo({ tenantId, userId, guestId, comboProductId, selection })`**: valida la
  selección contra la whitelist del combo (`services/combos.js:validateComboSelection`, compartida
  con [[Órdenes]]) y guarda `comboSelection` serializado en la única `CartItem` del combo. Volver a
  llamar reemplaza la selección anterior (no acumula selecciones distintas en dos líneas).
- **`CartModel.remove`**: decrementa 1 unidad; si llega a 0, borra la fila. Identifica la línea por
  `productId` + `variantId` (este último requerido en el body si el producto tiene más de una línea
  en el carrito — asimetría respecto a `add`, donde `variantId` siempre es opcional).
- **Precio nunca se guarda en `CartItem`**: se resuelve on-the-fly al leer (`GET /cart`) y al pasar a
  orden — el carrito nunca es la fuente de verdad del precio.

## Carrito de invitado (sin login)

Implementado end-to-end (commit `4fba8fd`) para permitir agregar al carrito sin loguearse:

- **`middleware/guestCart.js`** (montado en `routes/store/cart.js`, junto con `optionalStoreAuth` en
  vez de `verifyStoreToken`): si no hay sesión, emite/lee una cookie `guestId` y arma `req.cartOwner =
  { guestId }`; si hay sesión, `req.cartOwner = { userId }`. El endpoint delega en `CartModel` con lo
  que venga, sin distinguir lógica de negocio entre ambos casos salvo el merge (abajo).
- **Merge al loguearse**: `CartModel.mergeGuestCartIntoUser({ tenantId, userId, guestId })`
  (`services/cart.js:252-311`), invocado desde `controllers/store/auth.js` en el login del storefront
  — fusiona las líneas del carrito de invitado al carrito del usuario (suma cantidades clampeadas a
  stock disponible; si hay conflicto en la selección de un mismo combo, se queda con la del usuario
  logueado) y borra el carrito de invitado.
- **Checkout exige login**: `OrderModel.create` busca el carrito por `{ userId, tenantId }` — **no**
  acepta `guestId`. Un invitado tiene que loguearse (disparando el merge de arriba) antes de poder
  pasar su carrito a una orden; no existe un checkout 100% anónimo.
- **`TenantConfig.allowCartGuest` no tiene ningún efecto real**: el flag existe en el schema y en
  `schemas/tenant-config.schema.js`, pero `middleware/guestCart.js` nunca lo lee — el carrito de
  invitado está siempre activo para cualquier tenant, sin importar el valor del flag (ver Deuda
  técnica).

## Endpoints

### `routes/cart.js` (montado en `/cart`, auth `verifyToken`) y `routes/store/cart.js` (auth `optionalStoreAuth` + `resolveCartOwner`, admite invitado)
Mismo `controllers/cart.js` para ambas superficies. Solo la superficie storefront admite invitado —
el backoffice (`routes/cart.js`) sigue exigiendo `verifyToken` (sesión de staff/admin).

| Método | Ruta | Qué hace |
| --- | --- | --- |
| GET | `/` | Carrito completo, con `product`/`variant` resueltos (`variant` expone `{ id, attributes, sku }` — ver [[Variantes]]) y `comboSelection` si aplica |
| POST | `/:productId` | Agrega 1 unidad; body `{ variantId? }` | 
| POST | `/combo/:productId` | Arma y agrega un combo; body `{ selection: [{ productId, variantId?, quantity }] }` |
| PATCH | `/:productId` | Resta 1 unidad (o borra si llega a 0); body `{ variantId? }` |
| DELETE | `/` | Vacía el carrito completo |

> [!warning] Breaking change (2026-07-08)
> Antes de esta revisión las rutas eran `/cart/:variantId` (un combo tenía su propia variante
> sintética que actuaba de handle). Con el rediseño de tipos de producto las rutas pasaron a
> `/cart/:productId`. Ver `front-md-guia/FRONTEND_COMBOS.md` y [[Productos]] para el contrato
> completo. (2026-07-11: además `variant` en las respuestas expone `attributes` en lugar de
> `color`/`size` — ver [[Variantes]].)

## Dependencias
- [[Productos]] — `type` del producto determina si `variantId` aplica (null solo COMBO).
- [[Variantes]] — stock/precio/atributos de la línea.
- [[Combos]] — `comboSelection`, `CartModel.addCombo`.
- [[Órdenes]] — `OrderModel.create` lee y vacía el carrito; solo por `userId` (exige login, ver
  "Carrito de invitado" arriba).
- [[TenantConfig]] — `allowCartGuest` existe en la config pero no tiene efecto real (ver Deuda
  técnica).

## Integraciones externas
Ninguna directa.

## Deuda técnica / cosas raras
Etiquetas por tipo de acción — ver convención en [[App]].

- `[riesgo]` El índice único parcial que cubre `CartItem` con `variantId: null` vive únicamente en el
  SQL de la migración (no en `schema.prisma`) — un futuro `prisma db pull`/`migrate diff` no lo va a
  ver reflejado en el datamodel y podría tratarlo como drift. Documentado con comentario en
  `schema.prisma` junto a `CartItem`; si se automatiza algún proceso de diffing, revisar este caso.
- `[bug]` `TenantConfig.allowCartGuest` no tiene ningún efecto real: `middleware/guestCart.js` nunca
  lo lee, así que el carrito de invitado queda siempre activo para cualquier tenant, incluso uno que
  lo configuró en `false`. Corregirlo implica leer el flag en `guestCart.js` y devolver
  `401`/forzar login cuando esté desactivado.

## Preguntas abiertas / mejoras candidatas
- ¿Vale la pena exponer un endpoint para "actualizar cantidad a un valor exacto" en vez de solo
  incrementar/decrementar de a 1?
