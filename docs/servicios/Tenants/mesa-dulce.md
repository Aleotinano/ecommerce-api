---
tags: [tenant, mesa-dulce, estandar, combos]
estado: en-preparacion
ultima-revision: 2026-08-20
lado: backend
---

# Mesa Dulce

> [!note] Qué es
> Cookies clásicas, cookies rellenas y brownies de autor, producidos **por encargo** para
> eventos y mesas dulces. Su rasgo propio es el **combo a elección**: el cliente compra
> "4 brownies + 6 cookies clásicas" a precio fijo y elige los sabores dentro de cada
> familia. Es el tenant que motivó `ComboAllowedCategory` — ver [[Combos]].

> [!warning] Nació como demo y se está pasando a producción
> Hasta el 2026-08-20 este tenant existía **solo** como parte de `prisma/seed.js` (el seed
> monolítico que arranca con un `TRUNCATE` de toda la base). Sus scripts se llevaron al
> patrón de `prisma/<slug>/` para poder sembrarlo en el server sin tocar lo que ya está
> cargado. El log de la demo original, con el detalle de por qué el modelo cambió dos
> veces, quedó en [[mesa dulce demo]] — es historia, no estado.

## Qué es Mesa Dulce para el sistema

| | |
| --- | --- |
| Slug | `mesa-dulce` (tenantId 3 en dev; en prod, pendiente de crear) |
| Perfil de venta | `estandar` → `storeMode: SHOP`, CASH/TRANSFER/MIXED, DELIVERY/PICKUP, sin seña |
| Catálogo | 16 productos `PRODUCTO` + 5 `COMBO` = 21 |
| Categorías | 5, todas raíces hoja (un solo nivel), con `position` explícita |
| Atributos de variante | ninguno — `productVariantsEnabled: false` |
| Stock | 999 por variante al crearla; el seed no lo vuelve a tocar nunca |
| Promo | "Promo por cantidad": 3 unidades → 10%, 6 → 20%, sobre todos los `PRODUCTO` |
| Cloudinary | cuenta de la plataforma (`dqukj1pac`), donde ya viven las fotos |

## El catálogo

```
Cookies Clásicas    (position 0)   5 productos
Brownies            (position 1)   3 productos
Cookies Rellenas    (position 2)   8 productos
Combos              (position 3)   5 combos
Combo Mundialista   (position 4)   vacía
```

`Combo Mundialista` está vacía **a pedido del cliente**: ya no se vende y la dejan de
forma decorativa. No es un seed a medio terminar.

El sabor **es** el producto, no un eje de elección: cada uno tiene una sola variante
`isDefault` con `attributes: {}`. De ahí que `productVariantsEnabled` vaya en `false` y
que no haya `TenantAttribute` que cargar.

## Los combos

Los cinco usan `ComboAllowedCategory` (vía `comboCategoryOptions` en `ProductModel.create`),
no la whitelist plana `ComboAllowedProduct`: expresan "N fijo de una familia, a elección
dentro de la familia". Sin `productIds`, todos los productos activos de esa categoría son
elegibles.

| Combo | Precio | Composición |
| --- | --- | --- |
| Combo Mesa Dulce | $11.000 | 4 Brownies + 6 Cookies Clásicas |
| Combo Familiar | $18.000 | 6 Brownies + 12 Cookies Clásicas |
| Combo Entre Dos | $8.500 | 1 Cookie Rellena + 1 Brownie + 4 Cookies Clásicas |
| Rellenas y Clásicas | $19.000 | 3 Cookies Rellenas (whitelist de 5) + 12 Cookies Clásicas |
| COMBO PARA SORPRENDER | $11.500 | 2 Cookies Rellenas + 6 Cookies Clásicas |

"Rellenas y Clásicas" es el único con whitelist explícita: no todas las rellenas entran.

## Cómo se construye

A diferencia de [[pastaia]] y [[punto-healthy]], **no hay `build-menu.js` ni `menu.json`**:
el catálogo salió de capturas del panel real, no de un dump, y está hardcodeado en los
`.js`. Si algún día llega un dump, ahí sí conviene el pipeline.

```
prisma/mesa-dulce/
  categorias.js   5 categorías + requireTenant() (lo importan los otros dos)
  productos.js    16 productos, 5 combos, la promo
  config.js       branding, SEO, showOutOfStock
  ordenes.js      6 órdenes de demo — FUERA del index, ver abajo
  index.js        categorias -> productos -> config
```

Todos idempotentes y corribles sueltos (`pnpm seed:mesa-dulce:*`).

> [!danger] Las órdenes de demo no van a producción
> `ordenes.js` siembra 6 pedidos falsos de usuarios ficticios `@mesadulce.com`. Salió del
> orquestador el 2026-08-20 justamente porque `index.js` ahora se corre contra la base del
> cliente. Sigue disponible para dev con `pnpm seed:mesa-dulce:ordenes`, y `prisma/seed.js`
> la sigue sembrando por su cuenta (importa los módulos sueltos, no el `index.js`).

### Stock: alto a propósito

Producen por encargo y no llevan inventario, así que el control de stock no gobierna nada
acá. La combinación es **999 por variante + `showOutOfStock: true`**: una variante en 0 se
sigue mostrando en la carta (con el default `false`, un catálogo en 0 se ve vacío) y el
seed **nunca pisa el stock** en un rerun, por si algún día lo manejan desde el panel.

Es la corrección de un pendiente viejo: la ficha de la demo registraba 15 productos en
`stock: 0`, con lo cual armar un combo real fallaba con `409 INSUFFICIENT_STOCK`.

### El precio sí se sincroniza, el stock no

`ensureProduct` compara el precio de la variante `isDefault` contra el archivo y lo
actualiza. Hasta el 2026-08-20 no lo hacía: el rerun no tocaba la variante para nada, así
que cambiar un precio acá y volver a correr el seed no tenía ningún efecto.

## Cómo se sube

Los cuatro pasos, en el server (ver el runbook de deploy):

```bash
node prisma/create-tenant.js --name "Mesa Dulce" --email <email> --profile estandar
node prisma/mesa-dulce/index.js
```

`slugify("Mesa Dulce")` da `mesa-dulce`, que es el slug que los seeds esperan. La
contraseña del admin se imprime **una sola vez**.

## Pendientes

**De datos del negocio** (el seed avisa al terminar):

- `contactPhone` y `contactAddress` — se cargan desde el panel.
- El email real de la dueña, para el alta del admin.

**De catálogo**:

- `COMBO PARA ALEGRAR` y `COMBO PARA ENAMORAR`: el panel real los muestra, pero su
  composición no está confirmada.
- 2 brownies y 1 producto de Cookies Rellenas que las capturas no dejaban leer.

**De código**:

- `ensureCombo` es idempotente por nombre pero **en el update no re-arma la composición**:
  cambiarle el `minQty` a un combo vigente no tiene efecto, hay que borrarlo a mano.
  [[punto-healthy]] ya lo resolvió con una "huella" (`huella()` / `huellaActual()` en
  `prisma/punto-healthy/combos.js`) que compara la whitelist en DB contra la carta y
  re-arma cuando difiere. Vale portarlo cuando se confirmen los dos combos que faltan.
- `syncPromo` siempre reporta "sincronizada", nunca "ya está al día". Es un update
  idempotente, pero rompe la lectura de la verificación de idempotencia.

## Dependencias

[[Combos]] (la semántica de `ComboAllowedCategory`), [[Categorías]] (`position`),
[[Productos]] (el precio de un `PRODUCTO` vive en su variante `isDefault`),
[[Perfiles de flujo de venta]], [[new-tenant-config]].
