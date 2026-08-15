---
tags: [tenant, punto-healthy, estandar, combos]
estado: vigente
ultima-revision: 2026-08-10
lado: backend
---

# Punto Healthy

> [!note] Qué es
> Franquicia de comida rápida saludable: bowls proteicos, smoothies, snacks sin harinas,
> bebidas funcionales y promos. Es el **primer tenant que carga combos desde un seed** y
> el primero con **variantes reales** (packs y sabores) en el mismo catálogo. A
> diferencia de [[maikai]], este catálogo **se compra**.

## Qué es Punto Healthy para el sistema

| | |
| --- | --- |
| Slug | `punto-healthy` (tenantId 9) |
| Perfil de venta | `estandar` → `storeMode: SHOP`, CASH/TRANSFER/MIXED, DELIVERY/PICKUP, sin seña |
| Catálogo | 31 productos `PRODUCTO` con 57 variantes, + 11 `COMBO` |
| Categorías | 10 = 5 raíces + 5 hijas, dos niveles |
| Atributos de variante | `presentacion` y `sabor` — `productVariantsEnabled: true` |
| Stock | 100 por variante al crearla; el seed no lo vuelve a tocar nunca |

Los datos de contacto (teléfono, dirección, WhatsApp, Instagram) están **sin cargar**: son
por local y todavía no los tenemos. El storefront bespoke (landing) es trabajo aparte.

## El catálogo

```
Protein Bowls               2
Smoothies                   2     (Smoothie: 10 sabores · Express: 8)
Protein Snacks             10
Bebidas                    17     Calientes 10 · Frías 7
Promos                     11     Individuales 4 · Para compartir 3 · Para llevar 4
```

Las 11 promos son `Product` con `type: COMBO` y viven en las tres subcategorías de
`Promos`. Los combos **no tienen stock propio**: mueven el de sus componentes.

**11 productos se venden por presentación o por sabor** (packs de cookies/chipá/muffins,
packs x6 de las bebidas frías, los 10 sabores del Smoothie). En un `PRODUCTO` el precio
vive siempre en la variante `isDefault` y `Product.price` queda en `null` — la variante
default de cada uno es la primera de la carta (la presentación más chica).

## Cómo se construyó

```
pnpm tenant:create --name "Punto Healthy" --email <email> --profile estandar
pnpm punto-healthy:build-menu     # menu.json -> catalogo.json
pnpm seed:punto-healthy           # categorías -> atributos -> productos -> combos -> config
```

`prisma/punto-healthy/menu.json` es la **transcripción de la carta** y se comparte con el
repo del front (`scripts/seed-catalog/data/punto-healthy.menu.json`): se copia, no se
edita acá. Todo lo que el modelo necesita y la carta no dice —íconos, `position`, SKUs, y
sobre todo **cómo se expresa cada combo**— se decide en `build-menu.js`, que emite
`catalogo.json` y falla fuerte si una referencia no existe.

Todos los pasos son idempotentes: la segunda corrida no escribe nada. El de productos es
idempotente **por SKU** (sobrevive a un renombre) y el de combos **por nombre**,
re-armando la whitelist solo si dejó de coincidir con la carta.

> [!warning] El stock no se re-escribe nunca
> `STOCK_INICIAL = 100` se aplica solo al **crear** una variante. Si el seed lo
> re-escribiera en cada corrida borraría el stock real que el local viene manejando desde
> el panel. Es la diferencia con [[maikai]], que va con `stock: 0` porque en modo carta el
> stock no gobierna nada.

## Los dos patrones de whitelist de combo

El backend ofrece dos formas de armar un combo y **no se pueden mezclar en el mismo
combo**: si hay reglas de categoría, `comboMinItems`/`comboMaxItems` se derivan de ellas e
ignoran las standalone (`deriveComboRange`, `services/productos.js`), así que el total
quedaría mal y ninguna selección entraría. `planCombo` elige uno por combo:

| Patrón | Cuándo | Combos |
| --- | --- | --- |
| `comboCategoryOptions` | cada grupo cae entero en una categoría, y no hay dos grupos en la misma | 4 |
| `comboOptions` standalone | todo lo demás | 7 |

Se prefiere el de categorías porque **el mínimo de cada grupo se exige siempre**, aunque
el cliente no elija nada de ese grupo: el combo sale exacto o no sale.

Los dos casos que fuerzan standalone acá:
1. **Un grupo que cruza dos categorías.** Las "bebidas funcionales" de las promos son 14
   productos repartidos entre `Bebidas calientes` y `Bebidas frías`, y
   `ComboAllowedCategory` tiene `@@unique(comboProductId, categoryId)`: no hay forma de
   decir "1 entre estas dos categorías" sin habilitar 1 de cada una.
2. **Dos grupos de la misma categoría.** "Bon o Bon + (Chipá ó Snack Box)" son tres
   productos de `Protein Snacks` en dos grupos distintos.

> [!warning] En 4 combos el cliente puede desbalancear la selección
> El `minQty` de una regla standalone **solo se valida si el producto está en la
> selección** (`validateComboSelection` itera sobre lo elegido). Lo único que obliga es el
> total del combo, así que en un standalone con ítem fijo + grupo se puede cambiar el ítem
> fijo por otra unidad del grupo: pedir 2 bebidas en vez de "Pizza + 1 bebida". Afecta a
> *Protein Pizza + 1 bebida*, *Bon o Bon + Chipá ó Snack Box*, *2 bebidas + Protein Chipá*
> y *2 bebidas + Protein Box*. El precio es fijo igual y la orden pasa por `NEW` antes de
> producirse, así que el local lo ve; cerrarlo del todo necesita el fix de más abajo.
> `build-menu.js` los lista en su resumen en cada corrida.

## La fricción real: la whitelist es por producto, la carta habla de variantes

> [!success] El backend ya lo soporta (2026-08-15) — falta migrar ESTE catálogo
> `ComboAllowedProduct.allowedVariantId` está implementado (migración
> `20260815043933_add_combo_allowed_variant`, detalle en [[Combos]] → Alcance). Lo motivó
> [[pastaia]], que necesita packs con la caja fijada. **Las 7 promos de abajo siguen cargadas
> sin variante fijada**: pasarlas es editar `build-menu.js` para que `variantesReferenciadas`
> sea la fuente de las reglas en vez de un warning, y re-correr `pnpm seed:punto-healthy`.
> Lo que sigue describe el problema y el fix tal como se diseñó.

**Es la brecha principal que dejó este tenant.**

`ComboAllowedProduct.allowedProductId` apunta a un `Product`, no a una `ProductVariant`
(diferido explícito en [[Combos]]). Cuando un combo permite un producto, **todas sus
variantes activas quedan elegibles**. Pero 7 de las 11 promos de la carta hablan de una
presentación puntual:

| Combo | La carta dice | El cliente puede elegir |
| --- | --- | --- |
| Café Energy + Cookie ($3.000) | Cookies **x1** ($2.500) | Cookies x12 ($18.000) |
| 2 bebidas + Protein Chipá ($16.000) | Chipá **x4** ($8.000) | Chipá x12 ($18.000) |
| Bon o Bon + Chipá ó Snack Box | Chipá **x4** | Chipá x12 |
| 2 Smoothies + Chipá ó Snack Box | Chipá **x4** | Chipá x12 |
| Combo 1, Combo 3, Merienda Kids | packs de 6 y 12 | el pack chico (se auto-perjudica) |

Los tres primeros son plata: el combo se cobra igual y se lleva el pack caro. Hoy el
catálogo se cargó igual —la descripción de cada combo aclara la presentación— y el local
ve la orden antes de producirla, pero la validación server-side no lo impide.

**El fix** (implementado 2026-08-15; el paso 5 es el que falta para este tenant):

1. `ComboAllowedProduct.allowedVariantId Int?` — null = cualquier variante (comportamiento
   actual, sin migración de datos); con valor = solo esa. Mismo criterio de "opcional que
   no rompe lo existente" que se usó para `compareAtPrice`.
2. `validateComboSelection` (`services/combos.js`): al resolver la variante de cada línea,
   si la regla trae `allowedVariantId` y no coincide → `COMBO_VARIANT_NOT_ALLOWED`. Es el
   único punto de validación (lo comparten carrito y orden).
3. `getComboOptions`: filtrar `variants[]` del producto permitido a la variante fijada,
   para que el panel del combo no ofrezca lo que el server va a rechazar.
4. `schemas/product.schema.js`: `allowedVariantId` opcional en `comboOption` y en los
   miembros de `comboCategoryOption` (`productIds` pasaría a admitir
   `{ productId, variantId }`).
5. En el seed: `build-menu.js` ya emite `variantesReferenciadas` por combo y las imprime;
   pasarían a ser la fuente de esas reglas en vez de un warning.

El mismo cambio cierra también, para estos casos, el desbalanceo de arriba: una regla que
fija variante ya no es intercambiable con otra del grupo.

## Otras cosas que el modelo no representa

- **La ficha nutricional** ("PROTEÍNA 24G | GRASA 3G | …", la línea amarilla de la carta)
  no tiene campo propio: va concatenada al final de `description`, con el prefijo
  `VALORES POR UNIDAD —` cuando los macros son de una pieza y no del pack. Por eso el tope
  de `description` pasó de 400 a 600 en `schemas/product.schema.js` (la columna es `text`;
  el límite era de UI).
- **Descripción por variante**: el pack x6 de *Detox Deluxe frío* tiene su propio texto en
  la carta ("6 días consecutivos…") y `ProductVariant` no tiene `description`. Se perdió;
  `build-menu.js` lo avisa.
- **Combo con contenido fijo**: no existe: todo combo obliga a elegir
  (`COMBO_SELECTION_REQUIRED`). Los 4 combos de contenido cerrado de la carta se modelan
  como grupos de cantidad exacta, así que el cliente igual tiene que "armarlos" en el panel
  aunque no haya nada que decidir. Ver el diferido de [[Combos]].

## Decisiones de carta tomadas con el cliente

- **Bon o Bon Protein** no figura en ninguna página de producto: solo dentro de dos promos.
  Se carga a **$7.500**, precio deducido de la aritmética del ahorro
  (7.500 + 8.800 − 12.000 = 4.300). Sin ese producto esas dos promos no se pueden armar, y
  no puede ir inactivo (el validador rechaza componentes inactivos).
- **Detox Deluxe** está dos veces en la carta con el mismo precio y distinta descripción:
  quedó como `Detox Deluxe caliente` / `Detox Deluxe frío`.
- **Café Energy** se carga como producto simple a $3.500. El "agrandá por $1.000" de la
  carta **no está modelado**: sería una variante `Presentación` (Regular $3.500 / Grande
  $4.500), y arrastraría al combo "Café Energy + Cookie" al problema de variantes de
  arriba.
- **Los 4 lattes proteicos entran en las "bebidas funcionales"** de las 3 promos que usan
  esa selección (lectura literal del disclaimer de la carta: excluye solo Pink Beauty y
  Detox Deluxe). Sacarlos es editar la lista en `menu.json` y re-correr el seed.
- **El "AHORRÁ $X"** impreso se guarda como `Product.compareAtPrice` (precio de lista): el
  ahorro que muestra el storefront es `compareAtPrice - price`. 10 de las 11 promos lo
  traen; la de la dona de regalo no tiene badge impreso y quedó en `null` en vez de
  inventarle uno.

## Dependencias

- [[Perfiles de flujo de venta]] — perfil `estandar`, materializado en columnas al crear.
- [[Combos]] — los dos patrones de whitelist y sus diferidos.
- [[Variantes]] — `presentacion`/`sabor`, catálogo one-time del tenant.
- [[Productos]] — `compareAtPrice`, y el precio en la variante default.
- [[new-tenant-config]] — el pipeline de alta que este tenant sigue.
