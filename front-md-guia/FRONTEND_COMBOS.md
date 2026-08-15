---
lado: contrato
---

# Guía frontend: Combos (productos compuestos)

Feature: **combos** — un producto (`type: "COMBO"`) que el cliente arma eligiendo, dentro de una
whitelist de productos permitidos, cuántas unidades de cada uno quiere, hasta cumplir un total
mínimo/máximo. El precio del combo es **fijo** (no se cobra cada componente aparte); los componentes
elegidos determinan **stock** (se descuenta de cada componente real, no del combo) y quedan
registrados en la orden para producción.

> `COMBO` es uno de los DOS tipos de producto (`PRODUCTO`/`COMBO` — el enum se colapsó de los tres
> valores históricos; [FRONTEND_PRODUCT_TYPES.md](FRONTEND_PRODUCT_TYPES.md) describe el modelo viejo
> y quedó como referencia histórica). Todo `PRODUCTO` tiene siempre ≥1 variante (la principal,
> `isDefault`) y su precio/stock viven en la variante. Las rutas de carrito son por `productId`, no
> por `variantId`.
>
> Recordá las dos apps (ver [FRONTEND_INTEGRATION.md](FRONTEND_INTEGRATION.md)): la whitelist se arma
> en **Panel Admin** (alta/edición de producto); el armado del combo y el agregar al carrito pasan en
> **ambas apps**.

---

## 1. Modelo: campos de combo en `Product`

| Campo | Tipo | Notas |
|---|---|---|
| `type` | `"COMBO"` | el otro tipo es `"PRODUCTO"` |
| `comboMinItems` | number \| null | unidades TOTALES mínimas — **derivado** de la suma de `minQty` de las categorías (solo se manda explícito en el camino legacy sin categorías) |
| `comboMaxItems` | number \| null | unidades totales máximas, ídem derivado. `null` = algún grupo sin tope |
| `price` | number | precio FIJO del combo — no se cobra cada componente aparte |

Un combo **no tiene `variants[]`** — no manda `variants` al crear/editar.

### Whitelist por categoría (`comboCategoryOptions`, la canónica)

La whitelist de un combo se define por **categorías**: "el combo lleva 4 de la categoría Brownies y
2 de Cookies". Cada entrada: `{ categoryId, minQty, maxQty, productIds }`.

- `minQty`/`maxQty` son el **TOTAL DEL GRUPO**: la suma de unidades elegidas de esa categoría debe
  caer en `[minQty, maxQty]`, mezclando libremente entre los productos permitidos (el admin manda
  `minQty = maxQty` = cantidad exacta). El mínimo de cada grupo se exige **siempre**, aunque el
  cliente no elija nada de esa categoría.
- `productIds` son los **miembros explícitos** permitidos dentro de la categoría ("de los brownies,
  solo A y B"). Vacío u omitido = todos los productos activos de la categoría (incluye productos
  futuros). Cada miembro debe pertenecer a esa categoría (`400 COMBO_MEMBER_CATEGORY_MISMATCH`).
  Acepta **dos formas**, mezclables en el mismo array: `30` (cualquier variante del producto) o
  `{ "productId": 30, "allowedVariantId": 210 }` (solo esa presentación). Ver "Fijar la variante".
- Solo entran productos activos `type: "PRODUCTO"` (nunca `COMBO`, ni el propio combo).
- **No baja a subcategorías**: si whitelisteás una categoría padre, sus subcategorías NO quedan
  incluidas automáticamente.
- `comboMinItems`/`comboMaxItems` se **derivan** de la suma de estas reglas al guardar — no los
  mandes cuando haya `comboCategoryOptions` (se ignoran).

### Whitelist standalone (`comboOptions`, legacy)

Cada entrada: `{ allowedProductId, allowedVariantId?, minQty, maxQty }` — un producto puntual con
su propio rango per-producto. Se mantiene por compatibilidad (combos viejos) pero el admin nuevo ya no la genera.
Un producto con regla standalone aparece en `allowedProducts` con su propia regla y **no suma** al
grupo de su categoría. Independiente de `comboCategoryOptions` (editar una no toca la otra).

### Fijar la variante (`allowedVariantId`)

Por defecto, permitir un producto en un combo habilita **todas sus variantes activas**. Con
productos que se venden por presentación eso es plata: un combo que dice "1 cookie" ($2.500)
dejaba elegir el pack de 12 ($18.000) y se cobraba igual.

`allowedVariantId` acota la regla a **una sola variante**:

```json
{
  "comboCategoryOptions": [
    { "categoryId": 5, "minQty": 1, "maxQty": 1,
      "productIds": [{ "productId": 30, "allowedVariantId": 210 }] },
    { "categoryId": 8, "minQty": 2, "maxQty": 2 }
  ]
}
```

- **Ausente o `null` = cualquier variante activa**, el comportamiento de siempre. No hace falta
  tocar nada en combos que ya andan.
- Sirve tanto en `comboOptions` (standalone) como en los miembros de `comboCategoryOptions`. Lo
  que **no** puede fijar variante es una regla de categoría **sin** miembros explícitos: ahí la
  regla abarca la categoría entera, productos futuros incluidos.
- La variante tiene que ser **de ese producto** y estar activa, o el guardado falla con
  `400 COMBO_VARIANT_PRODUCT_MISMATCH` / `400 COMBO_VARIANT_NOT_ALLOWED`.
- En la lectura, `GET .../combo-options` devuelve `allowedVariantId` por producto y ya **recorta
  `variants[]` a la fijada** — no tenés que filtrar del lado del front.
- Al armar la selección podés mandar ese `variantId` o **no mandar ninguno**: si la regla fija una
  variante, el backend resuelve esa (no la default del producto).

---

## 2. Alta/edición del combo (Panel Admin)

`POST /products` y `PATCH /products/:id` (multipart, igual que cualquier producto):

```json
{
  "name": "Combo Mesa Dulce",
  "price": 11000,
  "categoryId": 17,
  "type": "COMBO",
  "comboCategoryOptions": [
    { "categoryId": 5, "minQty": 4, "maxQty": 4, "productIds": [30, 31] },
    { "categoryId": 8, "minQty": 2, "maxQty": 2 }
  ]
}
```

(Deriva `comboMinItems: 6` / `comboMaxItems: 6` — 4 de la categoría 5, solo productos 30 y 31, más
2 de cualquier producto de la categoría 8.)

- Un combo **no manda `variants` ni `comboMinItems`/`comboMaxItems`** (derivados).
- En `PATCH`, **mandar `comboOptions`/`comboCategoryOptions` reemplaza esa whitelist completa** — no
  hay merge incremental, y son independientes entre sí: si mandás solo uno de los dos campos, el otro
  queda intacto.
- Ningún producto de la whitelist puede ser otro combo (`400 COMBO_NESTED_NOT_ALLOWED`) ni el propio
  producto (`400 COMBO_PRODUCT_NOT_ALLOWED`). `categoryId` debe existir y ser del tenant
  (`404 CATEGORY_NOT_FOUND`); cada `productIds[]` debe pertenecer a su categoría
  (`400 COMBO_MEMBER_CATEGORY_MISMATCH`).

### Form de alta/edición: UX del admin actual

1. Activar "Es un combo" → campo Precio + selector de categorías en acordeón: por cada categoría
   elegida, un input de **cantidad exacta** (se manda `minQty = maxQty`) y el picker de productos
   permitidos (todos tildados por default = `productIds: []`; destildar materializa la lista
   explícita).
2. Al guardar, mandar `comboCategoryOptions` completo (no solo los cambios) — reemplaza la whitelist
   de categorías.

---

## 3. Consultar la whitelist de un combo

`GET /products/:id/combo-options` (Panel Admin, cookie) y
`GET /store/products/:id/combo-options` (Storefront, público) — mismo shape:

```json
{
  "comboMinItems": 6,
  "comboMaxItems": 6,
  "allowedProducts": [],
  "allowedCategories": [
    {
      "categoryId": 5,
      "categoryName": "Brownies",
      "minQty": 4,
      "maxQty": 4,
      "memberProductIds": [30, 31],
      "products": [
        {
          "productId": 30,
          "name": "Brownie Clásico",
          "img": "https://...",
          "type": "PRODUCTO",
          "minQty": 4,
          "maxQty": 4,
          "allowedVariantId": null,
          "variants": [{ "id": 210, "attributes": {}, "price": 800, "stock": 40 }]
        },
        {
          "productId": 32,
          "name": "Remera del combo",
          "img": "https://...",
          "type": "PRODUCTO",
          "minQty": 0,
          "maxQty": null,
          "allowedVariantId": null,
          "variants": [
            { "id": 220, "attributes": { "color": "#000000", "talle": "M" }, "price": 5000, "stock": 8 },
            { "id": 221, "attributes": { "color": "#ffffff", "talle": "M" }, "price": 5000, "stock": 3 }
          ]
        }
      ]
    }
  ]
}
```

- El precio de cada componente es **referencial** (para mostrar "$800 c/u") — no se cobra aparte, el
  total lo pone el precio fijo del combo. Precio y stock de cada componente viven en sus
  `variants[]` (todo `PRODUCTO` tiene al menos la variante principal).
- `variants[].attributes` es un JSON **dinámico por tenant** (`{ "color": "#000000", "talle": "M" }`,
  `{}` si el producto no tiene atributos reales — caso típico de "1 sola variante, sin opciones que
  elegir"). Las keys válidas y su `label`/orden de display salen de `GET
  /tenant-attributes/:tenantId` (`{ attributes: [{ key, label, type, position }] }`,
  `type: "COLOR"` → swatch, `"TEXT"` → chip/select) — pedilo una vez por sesión, no cambia por
  combo. **No asumas `color`/`talle` fijos**: un tenant de otro rubro puede tener `sabor`/`tamaño`.
- `allowedCategories[].minQty/maxQty` son el **total del grupo** (los mismos valores se replican en
  cada producto del grupo por compatibilidad de shape — no son topes per-producto).
- `memberProductIds` no vacío = la categoría tiene miembros explícitos y `products` trae SOLO esos;
  vacío = toda la categoría (y `products` trae todos sus productos activos). El admin lo usa para
  precargar el picker.
- `allowedProducts` son las reglas standalone legacy (per-producto, con su propio `minQty`/`maxQty`)
  — los combos nuevos del admin vienen con este array vacío.
- `400 PRODUCT_NOT_COMBO` si el `:id` no es un combo.

### Panel del combo (UI storefront) — guía de implementación del drawer

1. Card de producto combo: distinguila con un badge ("Armá tu combo") cuando `type: "COMBO"` (ese
   campo ya viene en la respuesta normal de `GET /store/products` y `GET /store/products/:id`).
2. Al abrir el drawer, pedí en paralelo: `GET /store/products/:id` (nombre/precio fijo/imagen del
   combo) + `GET /store/products/:id/combo-options` (whitelist) + `GET
   /tenant-attributes/:tenantId` si algún producto puede tener más de una variante (una sola vez por
   sesión, no por combo — ver nota de `attributes` arriba). Loading combinado de las tres.
3. **Estado del componente**: aplaná `combo-options` a una lista de "opciones elegibles" indexada
   por `productId`, cada una con su grupo de origen — así no hace falta recorrer
   `allowedCategories`/`allowedProducts` por separado en el render:
   ```ts
   type ComboOption = {
     productId: number; name: string; img: string | null;
     allowedVariantId: number | null;   // no-null => presentación fija, sin picker
     variants: { id: number; attributes: Record<string, string>; price: number; stock: number }[];
     groupKey: string;    // `category:${categoryId}` o "standalone"
     groupLabel: string; groupMinQty: number; groupMaxQty: number | null;
   };
   type Selection = Record<number, { variantId: number | null; quantity: number }>;
   ```
   - `allowedVariantId !== null` → la regla fija la presentación. El backend ya recortó `variants[]`
     a esa sola, así que **no va picker**: mostrala como dato fijo ("pack x4") y stepper directo.
   - `variants.length === 1` → sin picker de atributos, stepper de cantidad directo (igual guardá
     ese `variantId`, no lo mandes `null` al submit).
   - `variants.length > 1` → picker de atributos obligatorio (labels del catálogo de
     `tenant-attributes`) que **bloquea el stepper de cantidad** hasta que haya `variantId` elegido.
4. Una sección por cada entrada de `allowedCategories` (encabezado "Elegí {minQty} de
   {categoryName}" — o "entre {minQty} y {maxQty}" si difieren — seguido de sus `products[]` con
   selector de cantidad +/- y picker de atributos si aplica). Si hay `allowedProducts` (combos
   legacy), listalos aparte en una sección "Otros" con su propio selector — límites por-producto, no
   de grupo. Un producto solo aparece en un lugar u otro. Mostrá un contador de progreso por grupo,
   ej. "Brownies: 2 de 4" (arrancá el contador mostrando el mínimo aunque el usuario no haya tocado
   ese grupo — el mínimo se exige igual).
5. Validación en el cliente (solo UX, no autoritativa — el server es la fuente de verdad):
   - Cada grupo de categoría: `sum(quantity) ∈ [minQty, maxQty]`, exigido **aunque el usuario no
     elija nada de ese grupo**.
   - Cada standalone: `quantity` dentro de su propio rango.
   - Total: `sum ∈ [comboMinItems, comboMaxItems]`.
   - Ningún producto con `variants.length > 1` sin `variantId` elegido.
   - No superar `stock` de la variante activa.

   Deshabilitá "Agregar al carrito" hasta cumplir las 5, y mostrá **qué falta** (no solo un botón
   mudo) — ej. "Faltan 2 de Brownies".
6. Reabrir el drawer de un combo que ya está en el carrito: precargá `Selection` desde el
   `comboSelection` de `GET /store/cart` (no hace falta re-pedir `combo-options` salvo que quieras
   refrescar stock/whitelist por si cambiaron mientras tanto).
7. Si el submit devuelve un 400/409 de negocio (catálogo desincronizado — stock o whitelist cambió
   con el drawer abierto), refrescá `combo-options` y avisá al usuario qué cambió en vez de fallar
   en silencio.

---

## 4. Agregar el combo al carrito

`POST /cart/combo/:productId` (Panel Admin) y `POST /store/cart/combo/:productId` (Storefront) —
**`:productId` es el producto combo** (el mismo `id` del detalle de producto, no un `variantId`).

```json
// body
{
  "selection": [
    { "productId": 12, "quantity": 4 },
    { "productId": 13, "variantId": 108, "quantity": 4 }
  ]
}
```

Cada entrada de `selection` es `{ productId, variantId?, quantity }` — `productId` es el producto
permitido (sacalo de `combo-options`); `variantId` es opcional: si el componente tiene opciones
reales (más de una variante activa) mandá la elegida (`...variants[].id`), si no, omitilo y el
server resuelve la variante principal.

```json
// 201
{
  "message": "Combo agregado al carrito",
  "data": {
    "producto": "Combo Mesa Dulce",
    "productId": 21,
    "cantidad": 1,
    "seleccion": [
      { "productId": 12, "variantId": null, "quantity": 4 },
      { "productId": 13, "variantId": 108, "quantity": 4 }
    ]
  }
}
```

- **Volver a llamar este endpoint reemplaza la selección anterior** de ese combo en el carrito (no
  acumula selecciones distintas en dos líneas — hay una sola línea por combo). Si el usuario reabre el
  panel y cambia la selección, mandá el `selection` completo de nuevo.
- `GET /cart` (Panel Admin) / `GET /store/cart` (Storefront) — la línea del combo tiene
  `product.type: "COMBO"`, `variant: null`, y `comboSelection` con la selección:

```json
{
  "products": [
    {
      "product": { "id": 21, "name": "Combo Mesa Dulce", "type": "COMBO", "img": "https://..." },
      "variant": null,
      "price": 11000,
      "stock": null,
      "quantity": 1,
      "comboSelection": [
        { "productId": 12, "variantId": null, "quantity": 4 },
        { "productId": 13, "variantId": 108, "quantity": 4 }
      ]
    }
  ]
}
```

  `comboSelection` trae **solo** `productId`/`variantId`/`quantity` — para mostrar nombres en el
  resumen del carrito, resolvelos contra la respuesta de `combo-options` que ya pediste al armar el
  combo (o contra el catálogo).

### Errores al agregar un combo

| Código | Status | Cuándo |
|---|---|---|
| `PRODUCT_NOT_FOUND` | 404 | el `:productId` no existe o no es del tenant |
| `PRODUCT_NOT_COMBO` | 400 | el `:productId` no corresponde a un producto combo |
| `PRODUCT_NOT_AVAILABLE` | 400 | el combo está inactivo |
| `COMBO_SELECTION_REQUIRED` | 400 | `selection` vacío o ausente |
| `COMBO_SELECTION_OUT_OF_RANGE` | 400 | la suma de cantidades no está en `[comboMinItems, comboMaxItems]` |
| `COMBO_PRODUCT_NOT_ALLOWED` | 400 | algún `productId` de la selección no pertenece a la whitelist (incluye "está en la categoría pero no es miembro explícito") — `details.productId` |
| `COMBO_VARIANT_NOT_ALLOWED` | 400 | la regla fija una presentación (`allowedVariantId`) y la selección mandó otra variante — `details: { productId, elegida, permitida }`. Un front que respete `allowedVariantId` no debería verlo nunca |
| `COMBO_ITEM_QTY_OUT_OF_RANGE` | 400 | la SUMA de un grupo de categoría no respeta su `minQty`/`maxQty` (`details: { categoryId, minQty, maxQty, selected }` — también salta si falta el mínimo de un grupo no elegido) o, en reglas standalone legacy, la cantidad de ese producto (`details.productId`) |
| `VARIANT_NOT_FOUND` | 404 | el `variantId` mandado no existe o no es de ese producto |
| `INSUFFICIENT_STOCK` | 409 | algún componente elegido no tiene stock suficiente |

Todos siguen el shape estándar `{ "error": { "message", "code" } }`.

---

## 5. Checkout y detalle de orden

El checkout propaga la selección del combo sin cambios. (Lo que **sí** cambió en `POST /orders` es
otra cosa: desde 2026-07-23 exige un body con entrega y método de pago — ver
[FRONTEND_CHECKOUT.md](FRONTEND_CHECKOUT.md). No afecta a los combos.) En las
respuestas de orden (`POST /orders`, `GET /orders`, `GET /orders/all`, `GET /orders/:id`,
`POST /orders/:id/review`), cada línea de `productos[]` gana un campo **`combo`**:

```json
{
  "productos": [
    {
      "id": 501,
      "productId": 21,
      "variantId": null,
      "nombre": "Combo Mesa Dulce",
      "cantidad": 2,
      "precio": 11000,
      "subtotal": 22000,
      "note": null,
      "combo": [
        { "productId": 12, "variantId": null, "nombre": "Clásica Oreo", "cantidad": 8, "attributes": {} },
        { "productId": 13, "variantId": 108, "nombre": "Remera", "cantidad": 8, "attributes": { "color": "#000000", "talle": "M" } }
      ]
    }
  ]
}
```

- `combo: null` en cualquier línea que no sea un combo.
- Las cantidades de `combo[]` ya vienen **multiplicadas** por `cantidad` del combo (2 combos × 4 c/u =
  8 en el ejemplo) — no hace falta multiplicar en el front.
- `precio`/`subtotal` de la línea del combo ya reflejan el precio fijo total; los items de `combo[]`
  no tienen precio propio (se cobran en la línea padre).
- **Pantalla de revisión de pedido BOT** (`POST /orders/:id/review`): v1 solo permite reescalar la
  `quantity` de la línea del combo completo (recalcula proporcionalmente los componentes) — **no**
  permite agregar/quitar componentes desde esa pantalla todavía. Si el pedido necesita otra
  composición, hay que cancelarlo y rearmarlo.

### Render sugerido

- Carrito y detalle de orden: la línea del combo se muestra expandible/con un "+ ver contenido" que
  lista `comboSelection`/`combo[]` (nombre + cantidad de cada componente).
- Cocina/producción (si hay una vista operativa): mostrar `combo[]` desplegado por default, es la
  lista real de lo que hay que preparar.

---

## 6. Bot de WhatsApp

**Los combos no se venden por WhatsApp en esta versión.** Si un cliente le pide al bot un producto
`type: "COMBO"`, la tool responde con un mensaje conversacional (algo como "ese es un combo armable,
coordinalo por acá/en el local") en vez de crear el pedido — no hay nada que cambiar en el front por
esto, es 100% server-side.

---

## 7. Checklist de verificación

- [ ] Crear un combo (`type: "COMBO"`, `comboCategoryOptions` con 2 categorías con cantidad) desde
      el panel → `201`, `comboMinItems`/`comboMaxItems` derivados = suma de los grupos, y
      `GET /products/:id/combo-options` devuelve la whitelist.
- [ ] Crear/editar un combo con `productIds` en una categoría → `combo-options` expande SOLO esos
      miembros (`memberProductIds` poblado); un producto de la categoría que quedó afuera →
      `400 COMBO_PRODUCT_NOT_ALLOWED` al elegirlo.
- [ ] Categoría sin `productIds` → expande todos sus productos activos (`memberProductIds: []`).
- [ ] Editar un combo mandando solo `comboCategoryOptions` (sin `comboOptions`) → la whitelist
      standalone legacy queda intacta, solo cambia la de categorías (y viceversa).
- [ ] `comboCategoryOptions` con un `categoryId` inexistente → `404 CATEGORY_NOT_FOUND`; con un
      `productIds[]` de otra categoría → `400 COMBO_MEMBER_CATEGORY_MISMATCH`.
- [ ] Abrir el panel de un combo en el storefront → ver los grupos de `allowedCategories` con su
      cantidad y el stock por variante de cada producto.
- [ ] Exceder la suma de un grupo (o no llegar al mínimo de un grupo sin elegir nada de él) →
      `400 COMBO_ITEM_QTY_OUT_OF_RANGE` con `details.categoryId`.
- [ ] Agregar al carrito un producto permitido vía categoría → `201`, igual que cualquier otro
      componente.
- [ ] Un producto con `allowedVariantId` no-null → se renderiza sin picker de presentación, y el
      `variantId` que se manda es ese. Mandar otro a mano → `400 COMBO_VARIANT_NOT_ALLOWED`.
- [ ] Armar una selección por debajo del mínimo → el front bloquea "Agregar al carrito" (y si igual se
      manda, el backend devuelve `400 COMBO_SELECTION_OUT_OF_RANGE`).
- [ ] Agregar un combo válido al carrito (`POST /cart/combo/:productId`) → aparece como 1 línea con
      `comboSelection`.
- [ ] Volver a armar el mismo combo con otra selección y agregar de nuevo → la línea del carrito se
      actualiza (no se duplica).
- [ ] Completar el checkout → la orden trae 1 línea de combo con `combo[]` mostrando los componentes y
      cantidades multiplicadas por la cantidad de combos comprados.
- [ ] Completar la orden (`PATCH /orders/:id` → `COMPLETED`) → el stock que baja es el de los
      **componentes**, no el del combo.
- [ ] Pedirle un combo al bot de WhatsApp → responde con un mensaje, no crea la orden.

---

## 8. Ejemplos curl

```bash
# Crear un combo (la whitelist viaja como JSON string en el multipart)
curl -X POST --cookie "access_token=<jwt-admin>" \
  -F "name=Combo Mesa Dulce" -F "price=11000" -F "categoryId=17" -F "type=COMBO" \
  -F 'comboCategoryOptions=[{"categoryId":5,"minQty":4,"maxQty":4,"productIds":[30,31]},{"categoryId":8,"minQty":2,"maxQty":2}]' \
  http://localhost:4000/products

# Ver la whitelist de un combo (storefront, público)
curl "http://localhost:4000/store/products/21/combo-options" -H "X-Tenant-Slug: mesa-dulce"

# Armar y agregar un combo al carrito (storefront)
curl -X POST "http://localhost:4000/store/cart/combo/21" \
  -H "X-Tenant-Slug: mesa-dulce" -H "Authorization: Bearer <jwt-customer>" \
  -H "Content-Type: application/json" \
  -d '{"selection":[{"productId":12,"quantity":4},{"productId":13,"variantId":108,"quantity":4}]}'
```

---

## 9. Resumen

- `Product.type: "COMBO"` + `comboCategoryOptions` (`[{ categoryId, minQty=maxQty, productIds }]`,
  cantidad = total del grupo, `productIds` vacío = toda la categoría) se cargan como parte del
  alta/edición normal de producto (`POST`/`PATCH /products`) — sin `variants`;
  `comboMinItems`/`comboMaxItems` se derivan solos. `comboOptions` (standalone per-producto) es
  legacy e independiente.
- El panel de armado en el storefront necesita `GET .../:id/combo-options` además del detalle normal
  del producto; la respuesta trae `allowedCategories` (grupos con `memberProductIds` y sus
  productos expandidos, cada uno con sus `variants[]` para precio/stock/`attributes` dinámicos —
  labels vía `GET /tenant-attributes/:tenantId`) y `allowedProducts` (standalone legacy). Un
  producto nunca aparece duplicado en los dos arrays. Guía de implementación del drawer (estado,
  render por grupo, validación) en §3.
- Agregar al carrito es `POST /cart/combo/:productId` (el combo, sin variante) con
  `{ selection: [{ productId, variantId?, quantity }] }`, que **reemplaza** la selección anterior de
  ese combo.
- El precio del combo es fijo; el detalle de orden expone la composición real elegida en
  `productos[].combo` (o `null` si la línea no es un combo).
- El bot de WhatsApp no vende combos todavía — responde con un mensaje, no rompe.
