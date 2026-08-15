---
tags: [tenant, pastaia, estandar, variantes]
estado: en-preparacion
ultima-revision: 2026-08-15
lado: backend
---

# Pastaia

> [!note] Qué es
> Emprendimiento de pastas caseras congeladas listas para cocinar: sorrentinos, ravioles
> y raviolones, con masa y relleno a elección, por caja de 12, 24 o 48 unidades. Delivery
> de martes a domingo. Es el **primer tenant con dos ejes de variación en el mismo
> producto** — el producto cartesiano real que hasta ahora solo existía en los tenants
> demo.

> [!warning] Todavía no está cargado
> El pipeline (`prisma/pastaia/`) está escrito y verificado en seco, pero **el tenant no
> se creó y el seed no se corrió**: faltan los precios y los datos de contacto. Ver
> "Pendientes". `build-menu.js` falla a propósito mientras falte un precio.

## Qué es Pastaia para el sistema

| | |
| --- | --- |
| Slug | `pastaia` (tenantId pendiente) |
| Perfil de venta | `estandar` → `storeMode: SHOP`, CASH/TRANSFER/MIXED, DELIVERY/PICKUP, sin seña |
| Catálogo | 15 productos `PRODUCTO` con 111 variantes. Los packs (`COMBO`) quedan pendientes de composición y precio |
| Categorías | 4, todas raíces hoja (un solo nivel) |
| Atributos de variante | `masa` y `caja` — `productVariantsEnabled: true` |
| Stock | 999 por variante al crearla; el seed no lo vuelve a tocar nunca |

## El catálogo

```
Sorrentinos    4 productos × 9 variantes = 36
Ravioles       4 productos × 9 variantes = 36
Raviolones     4 productos × 9 variantes = 36
Salsas         3 productos × 1 variante  =  3
```

Los 12 productos de pasta salen de `formato × relleno` ("Sorrentinos de calabaza y
queso"); las 9 variantes de cada uno, de `masa × caja`:

| | |
| --- | --- |
| Rellenos (4) | jamón y queso · ricota y nuez · pollo y verdura · calabaza y queso |
| Masas (3) | Clásica · Remolacha · Albahaca |
| Cajas (3) | 12 · 24 · 48 unidades |
| Salsas (3) | blanca · tuco · mixta |

La variante `isDefault` de cada pasta es **Clásica + 12 unidades**, la opción de entrada
(mismo criterio que [[punto-healthy]]: la default es la primera de la carta). `Product.price`
queda en `null` en los 15 — el precio vive siempre en la variante.

## Cómo se repartieron los cinco ejes

El cliente describe cinco dimensiones: formato, relleno, masa, salsa y tamaño de caja. Como
ejes de elección puros serían **324 variantes**. Se reparten así:

| Eje | Dónde vive | Por qué |
| --- | --- | --- |
| Formato (3) | categoría raíz | Es cómo se navega la tienda, y son 3 de los 4 tiles del grid |
| Relleno (4) | nombre del producto | "Sorrentinos de calabaza y queso" es cómo se lo busca; habilita foto y descripción propias |
| Masa (3) | atributo `masa` | Eje de elección real dentro de la misma página |
| Caja (3) | atributo `caja` | Eje de elección con precio distinto por opción |
| Salsa (3) | producto aparte | Se suma al carrito; precio y stock propios |

### La salsa es un producto, no un eje de variante

Como cuarto eje de elección la salsa habría llevado el catálogo a 324 variantes. Como
producto suelto tiene precio y stock propios, y el cliente la suma al carrito. Además es
lo que hace posible los packs: **un combo necesita que sus componentes existan como
productos**.

## Packs para grupos (combos)

El diseño del storefront incluye una sección tipo "packs para grupos" (una caja grande +
salsas, con precio cerrado y badge de ahorro). Se modelan como `type: COMBO`.

Eso exigía cerrar antes una brecha del backend: `ComboAllowedProduct` apuntaba a un
`Product` y no a una `ProductVariant`, así que un pack que dice "48 unidades" habilitaba
también la caja de 12 — el combo se cobraba igual y se llevaba la caja cara. **Se
implementó** `ComboAllowedProduct.allowedVariantId` (2026-08-15, migración
`20260815043933_add_combo_allowed_variant`); el detalle está en [[Combos]] → Alcance y el
caso que lo motivó, en [[punto-healthy]].

Para Pastaia eso significa que un pack puede decir, y el server hacer cumplir:

```
Pack Fiesta  —  1 × Sorrentinos (caja x48, variante fijada)  +  2 × Salsas (cualquiera)
```

La caja se fija con `allowedVariantId`; las salsas van como regla de categoría sobre
`Salsas` sin miembros explícitos, así que cualquier salsa presente o futura entra.

> [!warning] La composición y el precio de cada pack son datos de negocio
> No se inventan (`new-tenant-config.md` §6 lista "composición de combos" explícitamente).
> Los packs no están cargados: falta que el cliente diga cuáles son, qué llevan y a cuánto.
> El `compareAtPrice` de cada uno es lo que costarían sus partes sueltas, y de ahí sale el
> "AHORRÁ $X" que muestra el storefront.

## Cómo se construye

```bash
pnpm tenant:create --name "Pastaia" --email <email> --profile estandar
pnpm pastaia:build-menu     # menu.json -> catalogo.json
pnpm seed:pastaia           # categorías -> atributos -> productos -> config
```

`prisma/pastaia/menu.json` es, a diferencia de los otros dos tenants, **una spec matricial
y no la transcripción de una carta**: declara formatos, rellenos, masas, cajas, salsas y la
tabla de precios, y `build-menu.js` **expande** el producto cartesiano en `catalogo.json`.
Es el archivo que se edita a mano para un cambio de precio o para sumar un relleno.

Todos los pasos son idempotentes: la segunda corrida no escribe nada. El de productos es
idempotente **por SKU** de la variante principal (sobrevive a un renombre).

SKU: `PA-<PRODUCTO>-<MASA>-X<UNIDADES>` → `PA-RAVIOLONES-DE-CALABAZA-Y-QUESO-REMOLACHA-X48`
(48 caracteres, el más largo; el tope del builder es 60). Derivado del **nombre**, nunca de
un índice: reordenar el catálogo no cambia la identidad de nada.

> [!warning] El stock no se re-escribe nunca
> `STOCK_INICIAL = 999` se aplica solo al **crear** una variante. 999 es explícitamente "no
> llevo control por variante": son 108 variantes de pasta y un freezer no se lleva bien con
> 108 contadores separados. En modo SHOP no puede ir en 0 (nada sería comprable), y si el
> seed lo re-escribiera en cada corrida borraría lo que el negocio venga manejando desde el
> panel.

## El modelo de precios

108 precios no se listan a mano. `build-menu.js` los calcula:

```
precio = base[formato][caja]
       + recargoMasaPorUnidad    × unidades   (si la masa no es Clásica)
       + recargoRellenoPorUnidad × unidades   (solo los rellenos con sobreprecio)
```

y redondea a la centena. `base` es una tabla de 9 y no un precio por unidad porque las cajas
grandes llevan descuento por volumen, y eso no se deriva. **El build imprime la grilla
completa de los 108 precios en cada corrida**, para que sea revisable antes de sembrar.

Si falta cualquier dato de precio, el build **falla y lista todo lo que falta de una vez**,
en vez de escribir un `catalogo.json` a medias. Un precio inventado que llegue a producción
se cobra de verdad.

## Pendientes

Bloqueantes para correr el seed:

1. **Precios** — la tabla `base` (9 números), `recargoMasaPorUnidad`, qué rellenos tienen
   sobreprecio y cuánto, y el precio de las 3 salsas. Todo va en `menu.json`.
2. **Email del dueño** — es lo que crea el primer ADMIN en `pnpm tenant:create`.
3. **Landing** — las 4 raíces se cargaron como hipótesis de los tiles del grid. El diseño ya
   está pensado del lado del cliente pero no lo vimos: **confirmar antes de correr
   `seed:pastaia:categorias`**, porque reordenar después no se puede desde el panel (ver
   abajo). Cada raíz necesita además `imageUrl` (la foto del tile) e `icon` — los íconos
   lucide que hay hoy (`circle-dot`, `grid-2x2`, `layout-grid`, `cooking-pot`) son
   provisorios.

No bloqueantes, quedan en `null` hasta que lleguen (no se inventan, `new-tenant-config.md` §6):

- Contacto: `contactPhone`, `contactAddress`, `contactEmail`, `socialWhatsapp` (formato
  `549…`, con el 9 de móvil que exige `wa.me`), `socialInstagram`, y `customerPhoneArea`.
  Se **omiten** del objeto de `config.js` en vez de ponerse en `null`: `update: CONFIG` pisa
  todo lo que declare, y un `null` borraría lo que se hubiera cargado desde el panel.
- Zona de cobertura y costo del envío — no hay campos para eso; van en `shippingPolicy`, que
  hoy solo dice lo que sabemos (martes a domingo, se despacha congelado).
- Tamaños de pote de las salsas. Si hay más de uno, dejan de ser productos de una variante:
  se suma un atributo `pote` en `atributos.js` (el upsert lo toma; el one-time no lo bloquea).

## Lo que este tenant deja expuesto

- **`Categories.position` no es seteable por HTTP.** `CategoryModel.create/edit` lo aceptan y
  lo escriben, pero no está en `schemas/category.schema.js` (que hace `.strip()`) ni lo pasa
  `controllers/categories.js` — se descarta antes de llegar al service. O sea: **el orden de
  la carta solo se puede fijar desde el seed**. Reordenar = editar `menu.json`, re-buildear y
  volver a correr. Esto contradice a [[Categorías]], que dice que se setea por `PATCH /:id`.
- **`ProductVariant` no tiene `description`.** Si una masa necesita aclaración, va en la
  descripción del producto (tope 600).
- **`GET /variants` pagina de a 20** (máx 100): con 108 filas, la pestaña de variantes del
  panel va a necesitar paginar de verdad.
- **El filtro por atributos es case-sensitive** sobre el valor
  (`?attributes={"caja":"48 unidades"}`), así que el storefront tiene que usar los valores tal
  cual vienen de `/store/products/options`.

## Dependencias

- [[new-tenant-config]] — el pipeline de alta que este tenant sigue.
- [[Perfiles de flujo de venta]] — perfil `estandar`, materializado en columnas al crear.
- [[Variantes]] — `masa`/`caja`, catálogo one-time del tenant y su rodeo por Prisma en el seed.
- [[Productos]] — el precio en la variante default; `Product.price` null en PRODUCTO.
- [[Categorías]] — `position` por nivel, y el `@@unique([tenantId, name])` global.
- [[Combos]] — los packs para grupos, y `allowedVariantId`, que se implementó para este tenant.
- [[punto-healthy]] — el tenant del que sale este pipeline, y la brecha de whitelist por
  variante que decidió el modelado de la salsa.
