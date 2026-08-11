---
tags: [demo, mesa-dulce]
estado: en-desarrollo
ultima-revision: 2026-07-08
lado: backend
---

# Demo — Mesa Dulce

> [!note] Alcance
> Demo del panel + storefront para el tenant "Mesa Dulce" (mesa dulce/panadería para eventos), acotada
> a 4 módulos: [[Productos]], [[Categorías]], [[Órdenes]], [[TenantConfig]] — más **combos** y el
> **rediseño de tipos de producto** (UNIDAD/VARIANTE/COMBO), sumados al alcance durante la
> preparación. Este documento es el punto de entrada.

> [!warning] Actualización 2026-07-11 — este doc es un log de sesión, el modelo cambió dos veces después
> 1. Los tipos se **colapsaron a 2** (`PRODUCTO`/`COMBO`): ya no existen UNIDAD/VARIANTE; todo
>    PRODUCTO tiene ≥1 variante (`isDefault`) y el precio/stock viven ahí — ver [[Productos]].
> 2. `color`/`size` se generalizaron a **atributos flexibles por tenant** (`attributes` Json +
>    catálogo `TenantAttribute`, seteo one-time) — ver [[Variantes]]. Para Mesa Dulce en particular:
>    sus productos "unidad" (cookies, brownies) van con `attributes: {}` y toda la identidad en
>    nombre+descripción; el catálogo de atributos solo hace falta si un mismo producto viene en
>    opciones (ej. torta por porciones). Atributo = eje de elección, no descripción.

> [!warning] Actualización 2026-07-22 — el módulo de abajo y buena parte de la checklist quedaron obsoletos
> Este log quedó congelado desde el 07-11 y no se tocó tras dos cambios reales posteriores:
> - **Catálogo de combos reconstruido el 07-20** (commit `751780e`,
>   `prisma/fix-mesa-dulce-categories-and-combos.js`): el script viejo citado abajo
>   (`seed-mesa-dulce-combos.js`) tenía "reglas incorrectas / un 4to combo no deseado" y sus datos se
>   perdieron en un reset de la DB dev. Hoy son **3 combos reales** (Combo Entre Dos $8.500, Combo
>   Mesa Dulce $11.000, Combo Familiar $18.000 — no existe "Rellenas y Clásicas"), armados con
>   `ComboAllowedCategory` en vez de whitelist plana de productos. Ver [[Combos]] para el detalle
>   completo (semántica de min/max por total-de-grupo, miembros explícitos, etc.).
> - **`Categories.position`** se agregó en el mismo commit para ordenar el árbol de categorías del
>   tenant — ver [[Categorías]].
> - La lista de "fuera de alcance"/"pendientes" de abajo tiene varios ítems ya resueltos u obsoletos
>   (ver anotaciones en línea).

## Módulos de la demo

- [[Productos]] — catálogo con tipo explícito por producto (`PRODUCTO`/`COMBO` desde el colapso, ver
  warning arriba).
- [[Categorías]] — árbol de categorías con imagen (Cloudinary) y orden configurable (`position`,
  agregado 07-20).
- [[Órdenes]] — creación desde carrito, máquina de estados, seña/depósito, notas por línea.
- [[TenantConfig]] — branding, contacto, SEO, políticas, toggle de variantes. **El toggle de seña ya
  no es del tenant** (2026-07-29): pasó al bloque de flujo de venta, que configuramos nosotros — ver
  [[Perfiles de flujo de venta]]. Mesa Dulce corre con el perfil `estandar` (los tres métodos de pago,
  las dos entregas, sin seña), que es el default: no necesitó configuración a medida.
- [[Combos]] — productos compuestos, el cliente arma su propio combo. Backend implementado; falta la
  UI de armado (frontend, contrato en `front-md-guia/FRONTEND_COMBOS.md`). Catálogo real de Mesa Dulce
  reconstruido el 07-20 (3 combos, ver warning arriba).
- [[Variantes]] — CRUD standalone de variantes, ahora exclusivo de productos `type: PRODUCTO`.
- [[Carrito]] — rutas por `productId` (breaking change, ver rediseño abajo); desde el 07-17 también
  admite invitado sin login (`guestId`), ver [[Carrito]].

## Checklist de tareas pendientes

### Bloqueantes — resueltos esta sesión
- [x] Arreglar el `select` de `services/tenant-config.js` (`get`/`update`) para que devuelva
      `productVariantsEnabled`, `depositEnabled`, `depositPercentage`. Ver `[bug]` (corregido) en
      [[TenantConfig]].
- [x] Commitear el diff en curso (variantes opcionales + notas de orden en [[Productos]] y
      [[Órdenes]]).
- [x] Implementar combos end-to-end (backend). Ver [[Combos]].
- [x] ~~Cargar los 4 combos reales de Mesa Dulce en la DB de dev
      (`prisma/seed-mesa-dulce-combos.js`)~~ — **[actualización 07-22] este script y estos 4 combos
      ya no reflejan el catálogo real**: se perdieron en un reset de la DB dev y el commit `751780e`
      (07-20) los reconstruyó como **3 combos** vía `ComboAllowedCategory`
      (`prisma/fix-mesa-dulce-categories-and-combos.js`) — ver [[Combos]].
- [x] **Rediseño de tipos de producto** (`Product.type`: `UNIDAD | VARIANTE | COMBO`), a pedido
      explícito del usuario — reemplaza el patrón implícito de "variante sintética" por un tipo
      explícito, con stock/precio de UNIDAD viviendo en columnas propias de `Product` (ya no en una
      `ProductVariant` oculta). Migración expand-contract en 2 pasos (`prisma/migrations/
      20260708190000_product_types_add` + `20260708200000_product_types_harden`), script de datos
      `prisma/migrate-product-types.js` corrido contra dev (21 productos, terminología de la época:
      17 UNIDAD, 4 COMBO, 0 VARIANTE — desactualizado por el reset/reconstrucción del 07-20, ver
      arriba). Tocó prácticamente todo el dominio de catálogo/carrito/órdenes/stats/bot — ver
      [[Productos]], [[Variantes]], [[Carrito]], [[Combos]] para el detalle por módulo.
- [x] **Breaking change de API**: rutas de carrito pasan de `/cart/:variantId` a `/cart/:productId`
      (`variantId` opcional en el body). Documentado en `front-md-guia/FRONTEND_PRODUCT_TYPES.md`
      (nuevo), `front-md-guia/FRONTEND_COMBOS.md` (actualizado) y `front-md-guia/FRONTEND_INTEGRATION.md`
      (tablas de rutas de `/store/cart/*` y `/cart/*` corregidas + aviso cruzado a las dos guías
      nuevas, para que el equipo de frontend no se quede con el shape viejo).
- [x] `pnpm test` → **213/213 tests pasando**.

### Bloqueante operativo pendiente (no es código)
- [ ] **Cargar stock real de las unidades de Mesa Dulce.** Verificado de nuevo el 2026-07-08 post-
      migración: 15 de los 17 productos `UNIDAD` activos siguen en `stock: 0` (Brownie Red Velvet,
      Turrón de Avena, Bon o bon y Nutella, Clásica Oreo, Pirinea, Brownie Oreo, Kinder y Nutella,
      Brownie Clásico, Clásica Red Velvet, Franuí, Chocotorta, Limón y Frutos Rojos, Clásica Limón y
      Amapolas, Clásica Chip, ChocoCookie) — cualquier intento de armar un combo real hoy falla con
      `409 INSUFFICIENT_STOCK`. Hay que cargar stock antes de la demo en vivo; no lo inventé porque es
      un dato de negocio que no me corresponde definir.

### Fuera de alcance de esta sesión
- [ ] UI de armado de combo en panel/storefront (contrato: `front-md-guia/FRONTEND_COMBOS.md`).
- [ ] UI de selector de tipo de producto en el form de alta/edición (contrato:
      `front-md-guia/FRONTEND_PRODUCT_TYPES.md`).
- [ ] Actualizar el front existente a las rutas nuevas de carrito (`/cart/:productId`) — breaking
      change, requiere coordinación con el repo de frontend.
- [ ] Soporte de combos en el bot de WhatsApp (hoy responde con un mensaje, no arma el pedido).
- [ ] Pricing suma-de-partes / híbrido, combos anidados (bloqueado a propósito), whitelist a nivel de
      variante específica, edición in-place de un combo ya en el carrito/orden — ver [[Combos]].
- [ ] Borrar la columna deprecada `Product.isCombo` (**[actualización 07-22]** `comboMinItems`/
      `comboMaxItems` NO son deprecados — son campos activos y centrales del modelo de combos actual,
      ver [[Combos]]; solo `isCombo` es código muerto: se sigue escribiendo en
      `services/productos.js` pero nunca se lee). El script `prisma/backfill-default-variants.js` ya
      no existe (borrado en el mismo commit que lo reemplazó por
      `prisma/migrate-collapse-product-types.js`) — este ítem de la checklist ya está resuelto para
      esa parte.
- [x] ~~Refrescar `docs/ARCHITECTURE.md` (desactualizado respecto al schema actual)~~ — **[actualización
      07-22]** se refrescó después de esta sesión (documenta el colapso a 2 tipos, `comboAllowedCategoryId`
      y los atributos flexibles), aunque a su vez quedó un paso atrás del commit `751780e` del 07-20
      (le falta `Categories.position` — corregido en esta misma revisión de docs).

## Notas sueltas de esta preparación
- El rediseño de tipos de producto fue un pedido explícito del usuario a mitad de la preparación de la
  demo, después de ver el feature de combos funcionando — decidió que quería `type` explícito en vez
  del patrón implícito de variante sintética, con stock/precio de UNIDAD en columnas propias de
  `Product` (no una variante oculta). Se ejecutaron las 9 fases de un plan de migración
  expand-contract en una sola sesión, sin pausas intermedias (confirmado con el usuario).
- El script `prisma/migrate-product-types.js` es el backfill de datos de esa migración — infiere
  `type` por producto (COMBO si tenía `isCombo`; VARIANTE si tiene variantes con color/size real o
  más de una; UNIDAD en el resto), mueve stock a `Product.stock`, desactiva variantes sintéticas
  obsoletas. Reintentable/idempotente (solo procesa productos con `type: null`).
- El script `prisma/seed-mesa-dulce-combos.js` sigue siendo idempotente (si el combo ya existe por
  nombre, lo salta).
- Queda `prisma/pre-type-migration-snapshot.json` (untracked) en la raíz de `prisma/` — el volcado de
  seguridad de la Fase 0 del plan de migración (`Product`/`ProductVariant`/`CartItem`/`OrderItem`
  antes de tocar nada). Con la migración ya verificada (213/213 tests + chequeo manual en dev) se
  puede borrar; se deja por ahora por si hace falta comparar contra el estado pre-migración.
