---
tags: [servicio, dominio/combos]
estado: estable
ultima-revision: 2026-07-22
lado: backend
---

# Combos

> [!note] Implementado (backend), catálogo real cargado para Mesa Dulce
> Construido de punta a punta: migración Prisma, `services/combos.js`, `services/productos.js`
> (whitelist embebida en create/edit + `getComboOptions`), `services/cart.js` (`addCombo`),
> `services/orders.js` (`priceItems` combo-aware, stock sobre componentes, árbol padre/hijos en
> `OrderItem`) y el guard de rechazo en el bot de WhatsApp. Tests en `tests/combos.test.js`. Contrato
> para el equipo de frontend: [FRONTEND_COMBOS.md](../../../front-md-guia/FRONTEND_COMBOS.md).
>
> **Revisión del 2026-07-08**: el combo pasó de tener su propia `ProductVariant` sintética (como
> handle de carrito) a ser simplemente un `Product` con `type = "COMBO"`, sin variante alguna — parte
> del rediseño general de tipos de producto. Todo el contrato de API que usaba `variantId` para
> referirse al combo ahora usa `productId` directo. **Nota:** el enum de tipos ya colapsó del todo a
> `PRODUCTO`/`COMBO` (ver [[Productos]]) — no quedan valores `UNIDAD`/`VARIANTE` en ningún lado del
> código, así que cualquier mención a esos nombres en este documento o en ejemplos de API es
> terminología vieja.
>
> **Whitelist por categoría con miembros explícitos (2026-07-09/07-10):** sumado
> `ComboAllowedCategory` — la whitelist de un combo puede incluir, además de productos puntuales
> standalone (`ComboAllowedProduct` con FK de categoría null), **categorías enteras** ("elegí 4 de
> la categoría Brownies"), opcionalmente acotadas a un subconjunto explícito de esa categoría
> (`ComboAllowedProduct.comboAllowedCategoryId` no-null = "miembro" de la regla). Migraciones
> `20260709033159_add_combo_allowed_category` y `20260710150000_combo_category_members`. La
> semántica de `minQty`/`maxQty` de una regla de categoría es el **total del grupo**, no un límite
> por producto individual — ver detalle abajo, corrige una versión anterior de este documento que
> decía lo contrario.
>
> **Catálogo real de Mesa Dulce (reconstruido 2026-07-20, commit `751780e`):** el script viejo
> `prisma/seed-mesa-dulce-combos.js` (8 jul, 4 combos con reglas por producto suelto) tenía "reglas
> incorrectas / un 4to combo no deseado" (mensaje del commit que lo reemplazó) y además esos datos se
> perdieron en un reset de la base de dev. Hoy el catálogo real son **3 combos** reconstruidos por
> `prisma/fix-mesa-dulce-categories-and-combos.js` usando `ComboAllowedCategory`: **Combo Entre Dos**
> ($8.500), **Combo Mesa Dulce** ($11.000), **Combo Familiar** ($18.000) — no existe "Rellenas y
> Clásicas". El mismo script también asignó `Categories.position` para ordenar el árbol de categorías
> del tenant (ver [[Categorías]]) y dejó creada una categoría "Combo Mundialista" sin combos
> asociados todavía (trabajo a medio terminar).

## Propósito
Mesa Dulce (y potencialmente otros tenants tipo panadería/eventos) vende "combos": productos
compuestos de otros productos (ej. "Combo Fiesta" = elegir 12 unidades entre galleta A, galleta B,
galleta C). El combo se modela **como un producto más** (`Product.type = "COMBO"`), no como una
entidad separada. El cliente arma su propio combo desde la UI: abre el panel del combo seleccionado →
debajo ve los productos permitidos para ese combo → agrega los que quiere hasta cumplir la cantidad
requerida.

## Modelo de datos

Extiende [[Productos]], [[Carrito]] y [[Órdenes]]. Un combo **no tiene `ProductVariant`** — es un
`Product` con `type = "COMBO"` a secas. Es el único caso sin variante: todo `PRODUCTO` tiene siempre
al menos su variante default (ver [[Productos]]).

### `Product` (campos de combo)
```
type           ProductType  // "COMBO" para un combo
comboMinItems  Int?         // unidades totales a elegir (suma de qty de la selección)
comboMaxItems  Int?         // null = sin tope superior explícito
price          Float        // precio FIJO del combo
```
Cuentan **unidades totales**, no líneas distintas (caso típico: "elegí 12 unidades entre estas
opciones"). Un combo de conteo fijo se modela con `comboMinItems = comboMaxItems`.

### `ComboAllowedProduct` — whitelist de productos permitidos (standalone o miembro de categoría)
```
model ComboAllowedProduct {
  id                     Int      @id @default(autoincrement())
  tenantId               Int
  comboProductId         Int
  allowedProductId       Int
  allowedVariantId       Int?     // null = cualquier variante activa; con valor = SOLO esa
  comboAllowedCategoryId Int?
  minQty                 Int      @default(0)
  maxQty                 Int?
  isActive               Boolean  @default(true)
  createdAt              DateTime @default(now())

  comboProduct     Product               @relation("ComboOptions", fields: [comboProductId], references: [id], onDelete: Cascade)
  allowedProduct   Product               @relation("AllowedInCombos", fields: [allowedProductId], references: [id], onDelete: Cascade)
  memberOfCategory ComboAllowedCategory? @relation("CategoryMembers", fields: [comboAllowedCategoryId], references: [id], onDelete: Cascade)
  tenant           Tenant                @relation(fields: [tenantId], references: [id])

  @@unique([comboProductId, allowedProductId])
  @@index([tenantId])
  @@index([comboProductId])
  @@index([comboAllowedCategoryId])
}
```
La whitelist apunta a un **`Product`** — cada producto permitido siempre es `type: "PRODUCTO"`
(nunca otro `COMBO`, sin anidamiento). Por defecto **todas sus variantes activas quedan
elegibles**.

> [!note] `allowedVariantId` — fijar la presentación (2026-08-15)
> Migración `20260815043933_add_combo_allowed_variant`. Con valor, la regla acota el producto a
> **una sola variante**: es lo que permite expresar "el pack lleva la caja x48" sin que el cliente
> pueda meter la x12. `null` = cualquier variante activa, el comportamiento histórico — por eso la
> columna nace nullable y la migración no tocó una sola fila.
>
> Aplica a los **dos sabores** de fila (una regla standalone y un miembro explícito de categoría
> pueden fijar variante por igual). Lo que **no** puede fijarla es una regla de categoría **sin
> miembros explícitos**: no tiene fila donde guardarla, y es correcto — "toda la categoría"
> incluye productos futuros cuyas variantes todavía no existen.
>
> `onDelete: Cascade`, igual que `allowedProductId`: si la variante fijada desaparece, la regla se
> va con ella. La alternativa (`SetNull`) volvería a habilitar todas las variantes **en silencio**,
> que es justo el bug que la columna cierra.

`comboAllowedCategoryId` distingue dos sabores de fila, según el comentario del propio schema:
- **`null` — regla standalone** (legacy, ex sub-tab "Unidad" del admin): `minQty`/`maxQty` acotan
  cuánto de ESE producto puntual puede elegirse dentro del combo. Tiene prioridad sobre cualquier
  regla de categoría y su cantidad **no** suma al total del grupo de su categoría.
- **no-null — miembro explícito** de una regla `ComboAllowedCategory`: marca pertenencia ("de los
  brownies, solo A y B"); sus propios `minQty`/`maxQty` **no se usan** — la cantidad la gobierna el
  total del grupo de la regla de categoría (ver abajo). El `@@unique([comboProductId,
  allowedProductId])` garantiza que un producto no puede ser standalone y miembro a la vez dentro
  del mismo combo.

Invariantes validadas en el service (`ensureComboOptionsValid`, `services/productos.js`):
- `allowedProduct.type !== "COMBO"` — **no se permiten combos anidados**, nunca.
- `allowedProductId !== comboProductId`.
- `comboProduct.type === "COMBO"`.
- Ambos productos del mismo `tenantId`.

### `ComboAllowedCategory` — whitelist de categorías enteras permitidas
```
model ComboAllowedCategory {
  id             Int      @id @default(autoincrement())
  tenantId       Int
  comboProductId Int
  categoryId     Int
  minQty         Int      @default(0)
  maxQty         Int?
  isActive       Boolean  @default(true)
  createdAt      DateTime @default(now())

  comboProduct Product               @relation("ComboCategoryOptions", fields: [comboProductId], references: [id], onDelete: Cascade)
  category     Categories            @relation(fields: [categoryId], references: [id], onDelete: Cascade)
  members      ComboAllowedProduct[] @relation("CategoryMembers")
  tenant       Tenant                @relation(fields: [tenantId], references: [id])

  @@unique([comboProductId, categoryId])
  @@index([tenantId])
  @@index([comboProductId])
  @@index([categoryId])
}
```
Alternativa a `ComboAllowedProduct` standalone para no tener que listar cada producto de una promo a
mano: "el combo lleva 4 de la categoría Brownies" en vez de whitelistear cada producto de esa
categoría uno por uno. `members` son los productos puntuales permitidos dentro de la categoría (filas
de `ComboAllowedProduct` con `comboAllowedCategoryId` seteado); **sin miembros = todos los productos
activos de la categoría** (incluye productos futuros). Solo entran productos activos
`type: "PRODUCTO"` (nunca `COMBO`, nunca el propio combo), y no baja a subcategorías.

**Semántica de `minQty`/`maxQty`: es el TOTAL DEL GRUPO**, no un límite por producto individual. La
suma de las cantidades elegidas de esa categoría (de sus miembros explícitos, o de cualquier producto
activo de la categoría si no tiene miembros) debe caer en `[minQty, maxQty]` — se exige **siempre**,
aunque la selección no incluya nada de esa categoría (el admin manda `minQty = maxQty` para "lleva
exactamente N"). `Product.comboMinItems`/`comboMaxItems` del combo se **derivan sumando** estas
reglas al guardar (`deriveComboRange`, `services/productos.js:236-243`) cuando el combo usa
`comboCategoryOptions` — dejan de ser un tope independiente que fija el admin a mano.

**Prioridad y resolución de membresía** (`validateComboSelection`, `services/combos.js:99-174`):
1. Si el producto elegido tiene una **regla standalone** (`comboAllowedCategoryId: null`), esa gana
   siempre — se valida su `minQty`/`maxQty` propio y su cantidad no suma a ningún grupo de categoría.
2. Si no, se busca si el producto es **miembro explícito** de alguna regla de categoría (fila con
   `comboAllowedCategoryId` seteado) — si lo es, siempre está permitido y su cantidad suma al total
   de ESA regla, aunque el producto haya cambiado de categoría real después (la pertenencia quedó
   fijada por la fila miembro, no se recalcula por `categoryId` actual).
3. Si no es miembro de nada, cae a la regla de su **categoría actual** (`product.categoryId`) —
   pero solo si esa regla **no tiene miembros explícitos** (una regla con miembros ya es una lista
   cerrada; un producto no listado no entra aunque comparta categoría).
4. Si no matchea ninguno de los tres casos → `COMBO_PRODUCT_NOT_ALLOWED`.

Un producto con regla standalone no se duplica en `allowedCategories` de `getComboOptions` (se
excluye de la expansión de la categoría, ya aparece en `allowedProducts`); lo mismo para los
miembros explícitos, que aparecen dentro de `allowedCategories[].products`, no en `allowedProducts`.

### `CartItem` — selección serializada
```
productId      Int     // el combo
variantId      null    // un combo nunca tiene variante
comboSelection Json?   // [{ productId, variantId?, quantity }], validado server-side al agregar
```
La fila del combo en el carrito es **una sola `CartItem`** (`productId` = el combo, `variantId` =
`null`); la selección va serializada en `comboSelection` — nunca se confía en ese JSON al leerlo, se
re-valida siempre al pasar a orden. Volver a llamar `addCombo` reemplaza la selección anterior.

### `OrderItem` — self-relation padre/hijos
```
parentItemId Int?
parentItem   OrderItem?  @relation("ComboItems", fields: [parentItemId], references: [id], onDelete: Cascade)
childItems   OrderItem[] @relation("ComboItems")
```
- **Fila padre** (el combo comprado): `productId` = el combo, `variantId = null`, `quantity` = combos
  comprados, `price` = precio fijo del combo, `parentItemId = null`.
- **Filas hijas** (una por componente elegido): `productId`/`variantId` del componente real
  (`variantId` siempre presente — todo componente es `PRODUCTO` y siempre resuelve a una variante,
  default o elegida), `quantity` = cantidad elegida × cantidad de combos, `price = 0` (el cobro ya
  está 100% en la fila padre), `parentItemId` = id de la fila padre.

`OrderItem.variantId` es nullable (ver [[Productos]], rediseño de tipos) — no hace falta ningún truco
de variante default para que esto funcione.

## Cálculo de precio y stock

**Precio: fijo, no suma de partes.** El combo cobra `Product.price` propio (resuelto vía
`helpers/price.js:getProductPrice`, que para `type === "COMBO"` devuelve `product.price` directo). Los
componentes elegidos no se sub-cobran — la whitelist define *qué* y *cuánto* se puede elegir, no
*cuánto cuesta cada elección*.

**Stock: se valida y descuenta sobre los componentes elegidos, nunca sobre el combo.** Un combo no
tiene columna de stock (`Product.stock` es `null` para `type = "COMBO"` — ver `helpers/price.js:
resolveProductStock`). Flujo en `priceItems()` (`services/orders.js`, única fuente de resolución de
precio/stock server-side):

1. Input acepta, por item, `{ productId, variantId?, quantity, comboSelection? }`.
2. Si `product.type === "COMBO"`, delega en `validateComboSelection` (`services/combos.js`):
   - Suma de `quantity` de la selección dentro de `[comboMinItems, comboMaxItems]` →
     `COMBO_SELECTION_OUT_OF_RANGE`.
   - Cada `productId` de la selección debe estar en `ComboAllowedProduct` del combo, activo, **o**
     su `categoryId` debe estar en `ComboAllowedCategory` del combo, activo (fallback, ver arriba)
     → `COMBO_PRODUCT_NOT_ALLOWED` si no matchea ninguna de las dos.
   - `minQty`/`maxQty` por componente si están seteados → `COMBO_ITEM_QTY_OUT_OF_RANGE`.
   - Si `checkStock` (true en checkout, false en borrador del bot), valida stock real de cada
     componente vía `resolveProductStock` (siempre `ProductVariant.stock` de la variante resuelta,
     ya que todo componente es `PRODUCTO`) → `INSUFFICIENT_STOCK`.
3. `priceItems` devuelve items planos + `comboChildren` para combos; `insertOrderItems` inserta primero
   el padre (para obtener su `id`) y luego los hijos con `parentItemId`, en la misma transacción.
4. `updateOrderStatus` (transición a `COMPLETED`): la lista de `stockLines` reemplaza cada línea combo
   por sus `childItems` (el padre nunca decrementa nada); cada línea real decrementa
   `Product.stock` o `ProductVariant.stock` según el `type` de SU producto (`decrementLineStock`).

## API

**Lectura** (whitelist + reglas, para armar el panel):
- `GET /products/:id/combo-options` (admin) + `GET /store/products/:id/combo-options` (storefront).
  Cachea con el mismo patrón `wrap()` de `services/productos.js` (300s), invalidado por cualquier
  escritura de producto.
```json
{
  "comboMinItems": 12,
  "comboMaxItems": 12,
  "allowedProducts": [
    {
      "productId": 1, "name": "Galleta A", "type": "PRODUCTO", "price": null,
      "minQty": 0, "maxQty": 6, "allowedVariantId": null,
      "variants": [{ "id": 10, "attributes": {}, "price": 500, "stock": 40 }]
    }
  ],
  "allowedCategories": [
    {
      "categoryId": 17, "categoryName": "Brownies", "minQty": 4, "maxQty": 4,
      "memberProductIds": [5, 6],
      "products": [
        {
          "productId": 5, "name": "Brownie clásico", "type": "PRODUCTO",
          "minQty": 4, "maxQty": 4,
          "variants": [{ "id": 20, "attributes": {}, "price": 300, "stock": 40 }]
        }
      ]
    }
  ]
}
```
`type` siempre es `"PRODUCTO"` (el enum de `ProductType` ya no tiene `UNIDAD`/`VARIANTE`, ver
[[Productos]]); el precio/stock reales viven siempre dentro de `variants[]` (todo `PRODUCTO` tiene
al menos su variante default, ver [[Variantes]]). Cada producto dentro de `allowedCategories[].products`
trae el `minQty`/`maxQty` de la regla de categoría replicado (son el total del grupo, iguales para
todos los productos de ese grupo — no hay override por producto individual salvo que se lo saque de
la categoría y se le dé una regla standalone en `allowedProducts`). `memberProductIds` viene vacío
si la regla no tiene miembros explícitos (aplica a toda la categoría, incluidos productos futuros);
si no está vacío, `products` ya viene expandido solo a esos miembros.

**Escritura de la whitelist**: embebida en `createProduct`/`updateProduct`, no un CRUD aparte.
`schemas/product.schema.js` valida `comboMinItems`/`comboMaxItems`/`comboOptions`/
`comboCategoryOptions` (solo si `type === "COMBO"`, `.superRefine`). `ProductModel.create`/`edit`
hacen el nested create/replace — `comboOptions` y `comboCategoryOptions` son **independientes**: si
un `edit` manda solo uno de los dos, únicamente esa whitelist se reemplaza (delete+createMany), la
otra queda intacta; si vienen ambos, se aplican atómicamente en la misma transacción. Mejora
candidata futura: `PATCH /products/:id/combo-options` incremental.

**Carrito**: `POST /cart/combo/:productId` (+ espejo storefront `/store/cart/combo/:productId`), body
`{ selection: [{ productId, variantId?, quantity }] }`. `CartModel.addCombo` valida con
`validateComboSelection` (compartida con `priceItems`) y hace upsert de la `CartItem` con
`comboSelection` serializado.

**Orden**: sin endpoint nuevo — `OrderModel.create` lee `cart.items` (ya trae `productId`/`variantId`/
`comboSelection` directo, sin resolución extra) y arma el input de `priceItems`. `orderItemsInclude`
trae `childItems` anidado para que `GET /orders/:id` devuelva el árbol completo.

## UI/UX (guía para frontend, alto nivel)

1. Card de producto combo con badge ("Armá tu combo") si `type: "COMBO"`.
2. Panel abre: `GET .../:id` (nombre/precio/imagen) + `GET .../:id/combo-options` (whitelist +
   min/max).
3. Renderiza contador de progreso ("Elegiste 8 de 12") + lista de `allowedProducts` con selector de
   cantidad (y de atributos — sabor/tamaño/etc., ver [[Variantes]] — si el producto permitido tiene
   más de una variante activa). Con `allowedVariantId` no-null el backend ya recortó `variants[]` a
   una sola: no va selector, y conviene mostrar la presentación como dato fijo ("pack x4").
4. Validación en frontend es solo UX (no autoritativa): total dentro de min/max, cada producto dentro
   de su `minQty`/`maxQty`, no exceder stock.
5. "Agregar al carrito" → `POST /cart/combo/:comboProductId`. El backend es la fuente de verdad;
   errores mapean a `COMBO_SELECTION_OUT_OF_RANGE` / `COMBO_PRODUCT_NOT_ALLOWED` /
   `COMBO_ITEM_QTY_OUT_OF_RANGE` / `COMBO_VARIANT_NOT_ALLOWED` / `INSUFFICIENT_STOCK`.
   `COMBO_VARIANT_NOT_ALLOWED` no debería llegarle nunca a un front que respete
   `allowedVariantId`: si viene, es que el panel ofreció una variante que la regla fija.
6. Carrito/checkout: línea del combo expandible con los componentes elegidos (`comboSelection`
   resuelto por `GET /cart`, con nombres, no solo ids).
7. Detalle de orden (cliente y admin): backend arma `{ ...parentItem, childItems: [...] }` ya agrupado
   — el frontend no agrupa un array plano por `parentItemId`.

Documento de contrato: `front-md-guia/FRONTEND_COMBOS.md`.

## Bot de WhatsApp — decisión explícita: NO en v1

`createDraftOrder` (ver [[Chat de tienda]]) rechaza combos con un mensaje amigable, chequeando
`product.type === "COMBO"` antes de resolver variante, sin tocar `TOOL_DEFINITIONS`.

Por qué diferir: `createDraftOrder` corre con `checkStock: false` (a pedido) — soportar combos
implicaría que el LLM le pregunte al cliente qué quiere, cuente unidades y las mapee a productId, con
riesgo de proponer cantidades fuera de rango o productos no permitidos. v2 (post-demo): extender
`items[].comboSelection` en el tool schema y delegar toda la validación real al `priceItems`
combo-aware ya construido — el bot solo propondría, el servidor sigue siendo la única fuente de
verdad.

## Alcance

### Implementado
Migración Prisma completa (`ComboAllowedCategory` — `20260709033159_add_combo_allowed_category` — y
miembros explícitos vía `ComboAllowedProduct.comboAllowedCategoryId` —
`20260710150000_combo_category_members`); `services/combos.js` (`validateComboSelection`: standalone
&gt; miembro explícito &gt; categoría actual sin miembros, total-del-grupo por regla de categoría);
`services/productos.js` (whitelist de productos + categorías, `deriveComboRange` para
`comboMinItems`/`comboMaxItems` sumados, `getComboOptions` con `allowedProducts`/`allowedCategories`
+ `memberProductIds`, validación de tipo/anidamiento); `schemas/product.schema.js` +
`schemas/combo.schema.js`; endpoints `GET .../:id/combo-options` (admin + store);
`services/orders.js:priceItems` combo-aware + `updateOrderStatus` con stock por componente +
`orderItemsInclude` con `childItems`; `services/cart.js:addCombo` + `POST /cart/combo/:productId`
(admin + store); guard de rechazo en el bot; catálogo real de Mesa Dulce (3 combos, ver nota de
arriba); 37 tests en `tests/combos.test.js`; `front-md-guia/FRONTEND_COMBOS.md`.

**Whitelist a nivel de variante (2026-08-15)** — `ComboAllowedProduct.allowedVariantId`, migración
`20260815043933_add_combo_allowed_variant`. Cierra la brecha que había dejado [[punto-healthy]].
Las cinco piezas:

1. Columna nullable + FK con `onDelete: Cascade` e índice. Sin migración de datos.
2. `validateComboSelection` (`services/combos.js`) rechaza con `COMBO_VARIANT_NOT_ALLOWED` cuando
   la línea trae otra variante. Es el **punto único** de validación: lo comparten carrito y orden.
3. Una línea **sin `variantId`** en un producto con variante fijada resuelve **la fijada**, no la
   default: el cliente que pide "Chipá" en un combo que lleva el pack de 4 no tiene por qué
   nombrar la presentación.
4. `getComboOptions` recorta `variants[]` a la fijada y devuelve `allowedVariantId` en cada
   producto permitido, para que el panel no ofrezca lo que el server va a rechazar.
5. `schemas/product.schema.js`: `allowedVariantId` opcional en `comboOption`, y
   `comboCategoryOption.productIds` acepta **las dos formas** —id suelto o
   `{ productId, allowedVariantId }`— normalizadas a la segunda. `services/productos.js` también
   las acepta (`normalizeComboMembers`), porque los seeds llaman al service directo salteando Zod
   y mandan ids sueltos.

Al guardar, `ensureAllowedVariantsValid` exige que la variante exista, sea del tenant, pertenezca
al producto de su regla (`COMBO_VARIANT_PRODUCT_MISMATCH`) y esté activa.

> [!warning] El catálogo de punto-healthy todavía no usa esto
> El mecanismo existe pero sus 7 promos afectadas siguen cargadas sin variante fijada. Pasarlas es
> editar `prisma/punto-healthy/build-menu.js` para que `variantesReferenciadas` sea la fuente de
> las reglas en vez de un warning, y re-correr el seed.

### Explícitamente diferido (decisión, no olvido)
- Bot de WhatsApp: soporte conversacional completo (v1 solo rechaza con mensaje amigable).
- Pricing suma-de-partes / híbrido (`comboPricingMode`).
- Edición in-place de un combo ya en carrito/orden (v1: quitar la línea completa y re-agregar).
- Combos anidados (bloqueado por validación server-side, nunca soportado).
- `ComboAllowedCategory` no baja a subcategorías: matchea `product.categoryId` exacto contra la
  categoría permitida, sin recorrer el árbol de [[Categorías]]. Si se whitelistea una categoría
  padre, sus subcategorías NO quedan incluidas automáticamente — hay que agregarlas explícitamente.
- QA explícito de `reviewOrder` sobre líneas de combo: el mecanismo opera por `OrderItem.id` así que
  debería "andar" (reescala cantidades existentes), pero no soporta agregar/quitar componentes del
  combo desde esa pantalla — abre la pregunta de si corregir la cantidad de una fila hija debería
  re-validar min/max del padre (hoy `reviewOrder` no re-corre esas validaciones).
- "Stock virtual" de un combo derivado de sus componentes (para dashboards/`ANGLE_PREDICATES`) — hoy
  los combos se excluyen directamente de los cálculos de stock, ver [[Productos]].
- **Combo cerrado / contenido fijo**: hoy TODO combo obliga al cliente a elegir componentes de una
  whitelist (`comboMinItems`/`comboMaxItems`). No existe un modo de combo con contenido fijo
  (sin selección) que se agregue al carrito como un producto simple — si un tenant necesita esto
  (ej. Mesa Dulce, ver [[App]]), es una brecha de producto a resolver, no solo de configuración.
  Workaround en uso ([[punto-healthy]]): el contenido fijo se expresa como reglas de cantidad exacta
  (`minQty = maxQty = qty`), así que el combo se arma igual pero el cliente tiene que "elegir" lo
  único elegible.
- **Ítem obligatorio en una whitelist standalone**: el `minQty` de una regla standalone solo se
  valida si el producto está en la selección (`validateComboSelection` itera sobre lo elegido, no
  sobre las reglas — a diferencia de las reglas de categoría, cuyo mínimo se exige siempre). En un
  combo "1 fijo + elegí 1" eso deja pasar 2 unidades del grupo y 0 del ítem fijo. Se nota solo
  cuando el combo NO puede usar reglas de categoría (grupo que cruza categorías, o dos grupos en la
  misma); 4 combos de [[punto-healthy]] están en esa situación.

## Dependencias
- [[Productos]] — el combo es un `Product` más (`type = "COMBO"`); whitelist referencia otros
  `Product` (siempre `type: "PRODUCTO"`).
- [[Categorías]] — `ComboAllowedCategory` referencia una `Categories`; expande a sus productos
  activos (sin bajar a subcategorías, ver diferido).
- [[Variantes]] — un componente resuelve a una `ProductVariant` real para stock/precio.
- [[Carrito]] — `comboSelection` en `CartItem`, `productId` = el combo.
- [[Órdenes]] — `priceItems` combo-aware, self-relation `OrderItem.parentItemId`. El decremento de
  stock por componente es un `UPDATE` condicional atómico (ver [[Órdenes]]), no un `[bug]` de
  carrera pendiente.
- [[TenantConfig]] — `productVariantsEnabled` es puramente cosmético del panel admin (no se lee en
  backend, ver [[Productos]]); no cambia si el selector de atributos aparece o no dentro del panel
  de combo en el servidor.

## Preguntas abiertas
- ¿`comboMinItems`/`comboMaxItems` deberían poder variar por rango de precio (ej. combo chico/grande
  del mismo producto), o cada tamaño es un `Product` combo distinto? Hoy asume lo segundo (un producto
  = un tamaño de combo fijo).
- ¿Vale la pena un `comboPricingMode` desde ahora aunque el default sea `FIXED`, para no requerir una
  migración adicional el día que se pida suma-de-partes?
