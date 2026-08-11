---
tags: [tenant, maikai, carta]
estado: vigente
ultima-revision: 2026-08-07
lado: backend
---

# Maikai

> [!note] Qué es
> Café, bar y restó en el centro de San Juan. Es el **primer tenant del perfil `carta`
> cargado entero** —251 productos, 8 raíces, 16 subcategorías— y por eso el ejemplo de
> referencia de [[new-tenant-config]]: el pipeline de alta se terminó de destilar acá.
> Su catálogo **se lee, no se compra**.

## Qué es Maikai para el sistema

| | |
| --- | --- |
| Slug | `maikai` |
| Perfil de venta | `carta` → `storeMode: MENU`, sin carrito ni checkout |
| Catálogo | 251 productos `PRODUCTO`, todos con una variante default y `stock: 0` |
| Categorías | 24 = 8 raíces + 16 hijas, dos niveles |
| Combos | ninguno. Los "Combos" del menú son platos, no combos armables (ver abajo) |
| Atributos de variante | ninguno — `productVariantsEnabled: false` |

El perfil sale de [[Perfiles de flujo de venta]] y se materializa en columnas al crear el
tenant; se corrige con `node prisma/set-tenant-profile.js maikai carta`. Los métodos de
pago y entrega quedan poblados a propósito aunque no gobiernen nada: el campo que define
qué es este tenant es `storeMode`, uno solo.

> [!warning] El modo carta hoy lo aplica solo el storefront
> No hay guard en el backend: `POST /orders` y `POST /store/orders` siguen aceptando
> órdenes de un tenant en `MENU`. Quien apaga el carrito y `/checkout` es el front,
> leyendo `storeMode` del `GET /tenant-config/:tenantId`. Si el front no lo lee, Maikai
> vende igual. Ver [[TenantConfig]] y la deuda de [[Órdenes]].

## El catálogo

Las **raíces son los tiles del grid de la home**, en el orden en que se muestran — no una
taxonomía del rubro. Esa fue la lección cara de este tenant: el menú se reorganizó dos
veces porque la primera fue antes de ver el diseño de la landing.

```
Pastas                      3
Almuerzos                  17     Menú Ejecutivo 12 · Ensaladas 5
Entre Panes                47     Ciabattas 23 · Focaccias 16 · Sándwiches y Lomos 8
Brunch                     24
Papas                      27     Presidenciales 14 · Fritas 7 · Para Compartir 6
Panadería y Postres        38     Panadería 27 · Postres 11
Café                       49     Cafés 20 · Ice Coffee y Frappé 11 · Agregados 18
Bebidas                    46     Coctelería 17 · Cervezas y Vinos 11 · Sin Alcohol 18
```

`Pastas` y `Brunch` son raíces **hoja**: cuelgan productos directo porque no tienen hijas.
Ninguna otra raíz tiene productos propios — un producto nunca cuelga de una raíz con
hijas.

## Cómo se construyó

Dump crudo del cliente → `build-menu.js` → `menu.json` → seeds. Los cuatro pasos viven en
`prisma/maikai/`, incluido el dump.

```bash
pnpm maikai:build-menu   # solo cuando llega un dump nuevo
pnpm seed:maikai         # categorías → productos → config
```

`menu.json` está commiteado y **es el archivo que se edita a mano** para un cambio de
precio suelto. `build-menu.js` no se corre en cada seed: existe para que el criterio de
reorganización quede en código revisable y se pueda volver a aplicar cuando el cliente
mande otra exportación, en vez de un JSON de 3.000 líneas editado a ojo.

Los tres seeds son idempotentes: las categorías por nombre, los productos por SKU. El SKU
sale del **nombre** (`MK-CIABATTA-DE-MILANESA`), nunca de un índice, que es justamente lo
que hace que reordenar la carta no cambie la identidad de un producto.

## Qué se le hizo al menú que mandó el cliente

De 276 filas del dump quedaron 251 productos. Las decisiones, todas en `build-menu.js`:

- **"Almuerzos" era una categoría espejo** y se descartó entera: sus 20 productos ya
  estaban, con el mismo precio, repartidos en Pastas, Ensaladas y Menú Ejecutivo. (El
  nombre se reusa como raíz del árbol destino, que no es lo mismo que la del dump.)
- **5 productos repetidos**, deduplicados por nombre normalizado —NFD, sin acentos, sin
  puntuación—, que es lo que hace que "Bagel Ibérico" y "Bagel Iberico" sean uno solo.
- **"Clásicos" aparecía dos veces**, bajo Café y bajo Coctelería, y `Categories` tiene
  `@@unique([tenantId, name])` **global, no por padre**: el segundo `create` fallaba. Se
  desdobló en "Cafés" y "Coctelería" con una lista explícita de los 17 tragos, no con una
  heurística sobre el nombre — "Espresso Maikai" y "Espresso Martini" son tragos que se
  llaman como un café.
- **Los 6 sándwiches americanos salieron de "Menú Ejecutivo"** y se fueron con las
  ciabattas y los lomos. Lo que quedó ahí son platos con guarnición.
- **Los "Combos" del dump no son combos**: son tostadas + infusión, o sea platos con la
  composición escrita en la descripción. Entran como `PRODUCTO`, no como [[Combos]].

## Config del tenant

En `prisma/maikai/config.js`, que **no toca el bloque de flujo de venta** — eso es del
perfil. Tres cosas que conviene saber antes de editarla:

- **El horario (9:00 a 3:00, de corrido) va embebido en la descripción.** [[TenantConfig]]
  no tiene campo de horarios de atención. Cuando la landing le dé un lugar propio, se
  mueve ahí.
- **`socialWhatsapp` lleva el 9 de móvil** (`5492645202525`). `wa.me` lo exige para los
  celulares argentinos, y el normalizador del storefront respeta tal cual cualquier número
  que ya empiece con 54: un `+542645202525` arma un link a un contacto inexistente.
- **`showOutOfStock: true`**, porque el catálogo entero está en `stock: 0`. Con el default
  (`false`) la carta se vería vacía. En un tenant `carta` el stock no gobierna nada —no
  nacen órdenes—, así que no se inventa un número que después alguien lea como real.

## Lo que falta

- [ ] **La landing.** Las 8 raíces existen para ser los tiles de su grid; el diseño todavía
      no está. Es el bloqueante real de este tenant.
- [ ] **Confirmar un precio con el cliente.** "Tarta de Coco" venía repetida con **precios
      distintos**: $6.000 en Postres y $5.000 en Panadería > Dulces. Gana la de Postres,
      fijado a mano en `DEDUP_WINNER` porque eso no lo puede decidir el dedup. Puede que la
      de panadería sea la porción y la de postres la torta entera. ("Tarta Cabsha" está en
      la misma lista, pero ahí los dos precios coincidían: se fija solo para que caiga en
      Postres y no en Panadería.)
- [ ] **El handle de Instagram.** Se ve truncado en la captura que pasó el cliente
      (`maikai.cafegrow…`) y no se inventa: `socialInstagram` queda sin cargar.
- [ ] **El guard de `storeMode: MENU` en el backend** (ver el aviso de arriba). No es de
      este tenant, pero es Maikai quien lo necesita primero.

> [!info] Las fotos de los tiles ya están en dev
> El seed deja `imageUrl` en `null` a propósito y su comentario todavía dice que las fotos
> no están, pero las 8 raíces de dev ya tienen la suya, cargadas aparte. No hay conflicto:
> el `update` del seed toca nombre, descripción, ícono, orden y padre — **nunca
> `imageUrl`**, así que volver a correrlo no las pisa.

## Cómo verificar

```bash
pnpm seed:maikai   # segunda corrida: todo "ya está al día". Si crea algo, no es idempotente
node prisma/set-tenant-profile.js   # maikai tiene que aparecer en "modo: carta (sin carrito)"
```

Y por HTTP, con `X-Tenant-Slug: maikai`:

- `GET /store/categories/tree` → las 8 raíces en orden con sus hijas. **No** `/store/categories`,
  que devuelve la lista plana ordenada por `position` global, o sea mezclada.
- `GET /store/products?limit=100&offset=…` → 251 en total, paginando de a 100 (el `limit`
  máximo).
- `GET /tenant-config/<tenantId>` → contacto, branding y `storeMode: "MENU"`.

## Relacionado

- [[new-tenant-config]] — el patrón de alta destilado de este tenant y los anteriores.
- [[Perfiles de flujo de venta]] — de dónde sale `carta`.
- [[mesa dulce demo]] — el otro tenant con catálogo real cargado, en modo tienda.
- [[Categorías]] — `position`, el árbol y el unique global por nombre.
- [[Productos]] / [[Variantes]] — por qué el precio vive en la variante default.
