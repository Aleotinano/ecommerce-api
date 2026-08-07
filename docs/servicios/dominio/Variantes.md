---
tags: [servicio, dominio/variantes]
estado: estable
ultima-revision: 2026-07-11
lado: backend
---

# Variantes

> [!note] Todo `PRODUCTO` tiene siempre ≥1 variante
> Desde el colapso de tipos ([[Productos]]), `Product.type` es `PRODUCTO | COMBO`. Todo `PRODUCTO`
> tiene **al menos una** `ProductVariant` (la principal, `isDefault=true`) — el precio y el stock
> viven SIEMPRE en la variante, nunca en columnas de `Product`. `COMBO` no tiene ninguna fila acá.

## Propósito
CRUD standalone de las variantes de un producto `PRODUCTO`: cada una es la unidad real de venta
(stock, precio propio, SKU único). Desde 2026-07-11 los ejes de variación son **atributos flexibles
por tenant** (ropa: color/talle; mesa dulce: sabor/tamaño) en lugar de las columnas fijas
`color`/`size`.

## Modelo de datos
Fuente: `prisma/schema.prisma` (modelos `ProductVariant`, `TenantAttribute`, enum `AttributeType`).

- **`ProductVariant`** — `tenantId`, `productId`, `attributes: Json = {}` (pares key→valor, ej.
  `{"color":"#fff","talle":"M"}` o `{"sabor":"chocolate"}`), `price: Float` (**NOT NULL** — no hay
  fallback a `Product.price`), `stock: Int`, `sku` (único por `tenantId`, autogenerado),
  `img?`/`imgPublicId?`, `isActive=true`, `isDefault=false` (la "principal"; índice único parcial
  garantiza a lo sumo una por producto, solo en SQL — ver [[Productos]]).
- **`TenantAttribute`** — catálogo de atributos del tenant: `key` (slug estable en minúsculas,
  `^[a-z0-9_-]{1,30}$` — sin ñ; el label sí puede llevarla), `label` (display), `type: AttributeType`
  (`TEXT` | `COLOR` — COLOR exige valor HEX `#RGB`/`#RRGGBB`, pensado para swatch), `position`
  (orden de display y de normalización). Único `(tenantId, key)`, cascade delete con el tenant.

### El catálogo es un seteo ONE-TIME
El catálogo de atributos se define **una sola vez** (onboarding): `PUT /tenant-attributes/:tenantId`
devuelve `409 ATTRIBUTES_ALREADY_SET` si ya existe. Cambiar keys/tipos después dejaría inconsistentes
las `attributes` ya escritas en las variantes — ese es el motivo del guard. Un catálogo **vacío es un
estado válido**: el tenant puede vender sin atributos (variante default con `attributes: {}`) y hacer
el setup más adelante, cuando aparezca la primera necesidad real.

> [!tip] Atributo = eje de elección, no descripción
> Un atributo existe solo si el cliente elige entre opciones del mismo producto (talle de una
> remera, porciones de una torta). "Chips de chocolate blanco" no es un atributo: es descripción del
> producto. Los valores deben ser cortos y repetibles — alimentan los filtros del storefront
> (`/store/products?attributes=…`) y la desambiguación del bot.

## Reglas de negocio / invariantes
- **Solo productos `type = PRODUCTO` admiten variantes**: `createVariant`/`editVariant` rechazan con
  `400 PRODUCT_IS_COMBO` si el producto es un combo (`services/variants.js`).
- **`attributes` se valida contra el catálogo del tenant** en el service
  (`TenantAttributeModel.validateAttributes`, `services/tenant-attributes.js`): toda key debe existir
  (`400 UNKNOWN_ATTRIBUTE`, con `details.validKeys`), los valores se trimean (1–80 chars) y si el
  atributo es `COLOR` se exige HEX (`400 INVALID_ATTRIBUTE_VALUE`). El objeto se **normaliza**: keys
  en minúsculas y en el orden de `position` del catálogo — así el orden de inserción JSON es estable
  y downstream (título de MercadoPago, vistas del bot) puede usar `Object.values()` sin conocer el
  catálogo. Zod (`schemas/variant.schema.js` + `schemas/tenant-attribute.schema.js`) solo valida el
  shape; la semántica es del service porque depende del tenant.
- **En `editVariant`, `attributes` reemplaza el objeto completo** (semántica PUT del campo, no merge
  por key).
- **La primera variante de un producto es automáticamente `isDefault`**; al borrar/desactivar la
  default con otras activas, se promueve la de menor id (`promoteNewDefault`).
- **No se puede borrar/desactivar la última variante activa** de un producto
  (`409 CANNOT_DELETE_LAST_VARIANT`) — lo dejaría invendible (no hay stock/precio de respaldo en
  `Product`).
- **SKU siempre autogenerado** (`generateUniqueVariantSku`), nunca provisto por el cliente.
- Scoping estricto por `tenantId` en toda query.

## Endpoints

### `routes/variants.js` (montado en `/variants`)

| Método | Ruta | Qué hace | Auth / rol |
| --- | --- | --- | --- |
| GET | `/:productId` | Lista variantes del producto (`[]` si no tiene ninguna) | `ADMIN` / `STAFF` |
| POST | `/:productId` | Crea variante (multipart, imagen opcional); body con `attributes` objeto o JSON string | `ADMIN` / `STAFF` |
| PATCH | `/:productId/:id` | Edita campos + imagen; `requireBodyOrImage`; `attributes` reemplaza completo | `ADMIN` / `STAFF` |
| DELETE | `/:productId/:id` | Borra (con guarda de última variante) + imagen de Cloudinary | `ADMIN` / `STAFF` |

### `routes/tenant-attributes.js` (montado en `/tenant-attributes`)

| Método | Ruta | Qué hace | Auth / rol |
| --- | --- | --- | --- |
| GET | `/:tenantId` | Catálogo ordenado por `position` → `{ attributes: [{ key, label, type, position }] }` | Público (`attachUser`) |
| PUT | `/:tenantId` | Setup ONE-TIME: `{ attributes: [{ key, label, type? }] }` (1–6, `position` = orden del array). `409` si ya existe | `ADMIN` |

El storefront no necesita endpoint propio: el catálogo (labels + tipos + valores en uso) viaja en
`GET /store/products/options` — ver [[Productos]].

## Dependencias
- [[Productos]] — el producto padre determina si admite variantes (`type = PRODUCTO`); las variantes
  embebidas en `POST/PATCH /products` pasan por la misma validación de atributos
  (`buildVariantsWithSku` en `services/productos.js`).
- [[Carrito]] y [[Órdenes]] — `variantId` en las líneas de tipo PRODUCTO; las respuestas exponen
  `attributes` de la variante (resuelto por join, no snapshot).
- [[Combos]] — un producto PRODUCTO puede ser componente permitido de un combo; la selección lleva
  `variantId`.
- [[Chat de tienda]] — las tools del bot filtran/desambiguan por `attributes` y usan los `label` del
  catálogo para hablar con el cliente.
- [[Redis y cache]] — el catálogo se cachea (`t<id>:attrs`, TTL 600s); el setup invalida ese key y
  todo `prod:*` del tenant.
- [[Almacenamiento de imágenes]] (Cloudinary) — imagen de variante.

## Integraciones externas
- **Cloudinary** para la imagen de variante.
- **MercadoPago** — el título del item se arma con `Object.values(variant.attributes)` en el orden
  del catálogo (`services/mercadopago.js:buildMpItemTitle`).

## Deuda técnica / cosas raras
Etiquetas por tipo de acción — ver convención en [[App]].

- `[riesgo]` **Editar variantes no invalida el cache `prod:*` de Redis** (TTL 180s de listados):
  un cambio de atributos/precio/stock vía `/variants` puede tardar hasta 3 min en reflejarse en el
  storefront. Preexistente al rediseño de atributos (pasaba igual con color/size).
- `[nota]` El match del filtro JSON (`attributes: { path: [key], equals: value }`) es
  **case-sensitive** sobre el valor — mismo contrato que tenían las columnas. El bot en cambio
  matchea case-insensitive (`attributesMatch` en `services/chat/tools.js`).

## Preguntas abiertas / mejoras candidatas
- ¿Permitir editar `label` (cosmético) del catálogo post-setup, manteniendo inmutables `key`/`type`?
- ¿Tipo `SELECT` con `options` (valores permitidos cerrados) para catálogos más estrictos?
