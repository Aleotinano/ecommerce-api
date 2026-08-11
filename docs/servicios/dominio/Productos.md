---
tags: [servicio, dominio/productos]
estado: estable
ultima-revision: 2026-07-22
lado: backend
---

# Productos

## Propósito
Catálogo de productos del tenant, con un **tipo explícito** (`Product.type`) que determina dónde vive
el stock/precio y qué datos aplican. Sostiene tanto el panel admin (`/products`, incluye inactivos)
como el storefront (`/store/products`, solo activos salvo `optionalStoreAuth` admin-preview).

## Modelo de datos
Fuente: `prisma/schema.prisma` (modelos `Product`, `ProductVariant`, enum `ProductType`).

- **`Product`** — `tenantId`, `name`, `description?`, `price: Float?` (**exclusivo de COMBO** — para
  PRODUCTO es siempre `null`, el precio vive en la variante default),
  `compareAtPrice: Float?` (precio de lista para tachar; misma invariante que `price`: solo COMBO —
  ver abajo), `categoryId?`, `img?`/`imgPublicId?` (Cloudinary), `isActive=true`, `createdAt`.
  Relación `variants: ProductVariant[]`, `category?`, `contentSuggestions`, `cartItems`,
  `orderItems`.
- **`compareAtPrice`** (migración `20260810204839_add_product_compare_at_price`) — el "antes $X" que
  se tacha; el ahorro a mostrar es `compareAtPrice - price`. Es un dato **cargado, no calculado**:
  en un combo es lo que costarían sus componentes sueltos según la carta del local, y nadie lo
  deriva de la whitelist (que define qué se puede elegir, no cuánto valdría). `null` = sin precio de
  lista, no se muestra nada. Validado en `schemas/product.schema.js`: tiene que ser mayor a `price`,
  y en un PRODUCTO se rechaza. El día que un PRODUCTO necesite precio tachado, el campo espejo va en
  `ProductVariant`, que es donde vive su precio. Primer uso real: las 10 promos con "AHORRÁ $X"
  impreso de [[punto-healthy]].
- **`type: ProductType`** (`PRODUCTO | COMBO`, **NOT NULL**) — fuente única de verdad de qué forma
  tiene el producto. Colapsado desde los 3 valores originales (`UNIDAD`/`VARIANTE`/`COMBO`) — ver
  Deuda técnica.
- **`ProductVariant`** — ver [[Variantes]]: `attributes: Json = {}` (atributos flexibles del catálogo
  `TenantAttribute` del tenant, ej. `{"color":"#fff","talle":"M"}` o `{"sabor":"chocolate"}`),
  `price: Float` (NOT NULL), `stock: Int`, `sku` único por tenant, `isDefault` (la principal). Solo
  existen filas para productos `type = PRODUCTO`.

### Los dos tipos

| Tipo | Precio | Stock | `variants[]` | Uso típico |
| --- | --- | --- | --- | --- |
| **PRODUCTO** | por variante (`ProductVariant.price`; la default es el precio "de lista") | por variante | ≥1 (la default; más si hay ejes de elección reales) | cualquier producto vendible por sí mismo — simple (una sola variante, `attributes: {}`) o con opciones (talle, sabor…) |
| **COMBO** | `Product.price` (fijo) | sin stock propio, ver [[Combos]] | vacío | producto compuesto de otros productos |

> [!note] Precio/stock efectivo
> `getProductPrice(variant, product)` y `resolveProductStock(product, variant)`
> (`helpers/price.js`) son la ÚNICA fuente de verdad para resolver precio/stock — branchean por
> `product.type`. Todo el código (órdenes, carrito, combos, stats, bot) pasa por estas dos funciones.
> Para PRODUCTO no hay fallback a `product.price`: la variante (default o elegida) siempre tiene
> precio propio. `resolveVariantForProduct` resuelve la default cuando no se eligió una.

## Reglas de negocio / invariantes
- **`type` es requerido al crear** (`POST /products`) y determina qué más es válido/requerido —
  validado tanto en `schemas/product.schema.js` como en `ProductModel.create`:
  - `PRODUCTO` — tres vías de alta: `variants` vacío (**alta en 2 pasos**: producto "vacío" → agregar
    la variante principal después vía `/variants/:productId`); `variants` con al menos una (la
    primera queda `isDefault`); o **atajo de 1 paso**: `price`+`stock` sueltos a nivel raíz del body
    (sin mandar `variants[]`) para que el service arme automáticamente la variante default en el
    mismo request (`services/productos.js`: `effectiveVariants = variants.length > 0 ? variants :
    price !== undefined ? [{ price, stock }] : []`; `schemas/product.schema.js` lo documenta como
    "atajo de alta en 1 paso"). Las `attributes` de cada variante embebida (de cualquiera de las tres
    vías) se validan contra el catálogo del tenant (`buildVariantsWithSku` →
    `TenantAttributeModel.validateAttributes`, ver [[Variantes]]).
  - `COMBO` — exige `price` (`PRICE_REQUIRED`) y rango (`COMBO_RANGE_REQUIRED` si no hay reglas de
    categoría que lo deriven), rechaza `variants` (`VARIANTS_NOT_ALLOWED`). Ver [[Combos]].
- **Cambiar `type` en `PATCH /products/:id` dispara una transición** (`ProductModel.edit`): los datos
  que dejan de aplicar se **desactivan** (`isActive=false`), nunca se borran — por integridad de
  `OrderItem` históricos. `PRODUCTO → COMBO` desactiva las variantes (preservando `isDefault` para
  poder volver); `COMBO → PRODUCTO` reactiva la que era default si existía.
- **`categoryId` debe existir y pertenecer al tenant** (`ensureCategoryExists`) si se manda; si no,
  `404 CATEGORY_NOT_FOUND`. `null`/ausente deja el producto sin categoría.
- **SKU único por tenant**, autogenerado (`generateUniqueVariantSku` → `utils/sku.js:generateSku`),
  reintenta hasta encontrar uno libre.
- **Filtro de catálogo por atributos** (`buildProductWhere` en `getAll`): el query param `attributes`
  (JSON URL-encodeado, ej. `?attributes={"talle":"M"}`) se traduce a filtros JSON path de Postgres
  sobre `ProductVariant.attributes` (match exacto por key/valor, case-sensitive). Solo matchea
  `PRODUCTO` (un combo no tiene atributos de variante); además recorta las `variants` incluidas en la
  respuesta a las que matchean. `minPrice`/`maxPrice` resuelve precio de variante para PRODUCTO y
  `Product.price` para COMBO, cada uno por su rama.
- **`categoryId` en `productQuery` acepta CSV** (`"1,2,3"`) o un solo id.
- **Borrado en cascada real**: `ProductModel.delete` borra el `Product`; Prisma cascadea sobre
  `ProductVariant`. No hay soft-delete — usar `isActive=false` para "despublicar" sin perder datos.
- **Imagen vía Cloudinary con rollback**: si `create`/`edit` fallan después de subir la imagen, se
  borra de Cloudinary en el `catch`; en `edit`, si se reemplaza la imagen, se borra la anterior tras
  confirmar el update.

## Endpoints

### Backoffice — `routes/productos.js` (montado en `/products`, auth `verifyToken`)

| Método | Ruta | Qué hace | Auth / rol |
| --- | --- | --- | --- |
| GET | `/` | Lista con filtros (`name`, `categoryId` CSV, `attributes` JSON, `minPrice`/`maxPrice`, `angle`, `limit`/`offset`); incluye inactivos si ADMIN/STAFF | Usuario autenticado |
| GET | `/options` | Por cada atributo del catálogo del tenant, los valores en uso: `{ attributes: [{ key, label, type, values }] }` | Usuario autenticado |
| GET | `/stats` | Agregados para stat cards: `total`, `active`, `lowStock`, `outOfStock` (stock por variantes; COMBO excluido de stock) | `ADMIN` / `STAFF` |
| GET | `/:id` | Detalle (con variantes activas) | Usuario autenticado |
| GET | `/:id/combo-options` | Whitelist del combo — ver [[Combos]] | Usuario autenticado |
| POST | `/` | Crea producto (multipart, imagen opcional); `type` requerido | `ADMIN` / `STAFF` |
| PATCH | `/:id/category` | Reasigna `categoryId` (incluye `null` para quitar) | `ADMIN` / `STAFF` |
| PATCH | `/:id` | Edita campos + imagen; `requireBodyOrImage` exige al menos uno; `type` dispara transición | `ADMIN` / `STAFF` |
| DELETE | `/:id` | Borra producto (cascade sobre variantes) + imagen de Cloudinary | `ADMIN` / `STAFF` |

### Storefront — `routes/store/products.js` (auth `optionalStoreAuth`, público con datos enriquecidos si hay sesión)

| Método | Ruta | Qué hace |
| --- | --- | --- |
| GET | `/` | Catálogo público (solo activos salvo admin-preview) |
| GET | `/options` | Igual que el backoffice, scoped al tenant resuelto por slug |
| GET | `/:id` | Detalle público |
| GET | `/:id/combo-options` | Whitelist del combo, público |

Validación de payload: `schemas/product.schema.js` (`createProduct`, `updateProduct`,
`assignProductCategory`, `productQuery`). `createProduct` usa `.superRefine` para las reglas
condicionales por `type`; `updateProduct` es más permisivo (no conoce el `type` actual en DB) y deja
que `ProductModel.edit` valide contra el estado existente.

## Dependencias
- [[Categorías]] — validación de `categoryId` al crear/editar.
- [[Variantes]] — unidad de venta de los productos PRODUCTO; SKU, stock, precio, atributos flexibles
  (`attributes` + catálogo `TenantAttribute` del tenant).
- [[Carrito]] y [[Órdenes]] — consumen `productId` (+ `variantId`, siempre resuelto para PRODUCTO —
  default o explícito — y `null` solo para COMBO); `getByAngle` cuenta unidades vendidas desde
  `OrderItem.productId` para destacados de marketing.
- [[Combos]] — el otro tipo de `Product`; whitelist de productos permitidos por producto
  (`ComboAllowedProduct`) o por categoría entera (`ComboAllowedCategory`).
- [[TenantConfig]] — `productVariantsEnabled` es puramente cosmético del panel admin: no se lee en
  ningún controller/service (grep confirma que solo aparece en `schema.prisma`,
  `schemas/tenant-config.schema.js` y docs) — no impide crear más de una variante por API aunque el
  tenant lo tenga en `false`.
- [[Almacenamiento de imágenes]] (Cloudinary) — imagen de producto.
- [[Redis y cache]] — `wrap()` cachea lista (180s), detalle (300s), combo-options (300s) y opciones de
  variante (600s); `getStats` reusa el TTL de lista. `getByAngle` **no** cachea.

## Integraciones externas
- **Cloudinary** vía [[Almacenamiento de imágenes]] para la imagen del producto.
- Sin otras integraciones externas directas.

## Deuda técnica / cosas raras
Etiquetas por tipo de acción — ver convención en [[App]].

- `[nota]` **Historia de los tipos** (dos rediseños sucesivos): primero se pasó de heurísticas
  implícitas ("variante sintética" `color/size: null`) a un `type` explícito de 3 valores
  (`UNIDAD`/`VARIANTE`/`COMBO`, script `prisma/migrate-product-types.js`); después se colapsó a 2
  (`PRODUCTO`/`COMBO`, migraciones `..._product_types_collapse_*` + script
  `prisma/migrate-collapse-product-types.js`) — la "variante default obligatoria" volvió, pero ahora
  explícita (`isDefault`) y como única fuente de precio/stock. Por último, `color`/`size` se
  generalizaron a `attributes` + catálogo `TenantAttribute`
  (`..._variant_flexible_attributes`, backfill SQL en la misma migración: color→`attributes.color`,
  size→`attributes.talle`).
- `[nota]` `Product.isCombo`/`comboMinItems`/`comboMaxItems` (columnas) se conservan un tiempo después
  de reemplazar `isCombo` por `type = "COMBO"` en el código — deprecadas (`isCombo` no se lee; los
  `comboMin/MaxItems` sí se usan para combos). Limpieza pendiente de `isCombo`.
- `[riesgo]` **Sin validación cruzada entre `productVariantsEnabled` y las variantes reales**: un
  tenant con el flag en `false` igual puede recibir variantes extra por API. Es puramente una señal
  de UI para el panel admin (ver [[TenantConfig]]).

## Preguntas abiertas / mejoras candidatas
- ¿Vale la pena una acción explícita "convertir a COMBO"/"convertir a PRODUCTO" en el panel admin,
  con confirmación, en vez de que la transición sea un efecto colateral de un `PATCH` genérico?
- ¿Cuándo se borra definitivamente `Product.isCombo` (columna deprecada) y el script
  `prisma/backfill-default-variants.js` (ya no aplica)?
