---
lado: contrato
---

# Guía frontend: Promos (descuento por cantidad)

Feature: **promos** — un descuento porcentual escalonado por cantidad sobre uno o varios productos
puntuales (`type: "PRODUCTO"`, nunca `COMBO`). Ej: "llevando 3+ unidades, 10% off; 5+, 20% off". La
cantidad se cuenta **sumando todas las variantes** del producto en el carrito/orden (2 de un talle +
2 de otro talle = 4, no dos líneas de 2). El descuento se aplica **de verdad**: en el precio que ve el
cliente en el carrito y en el total que se cobra en la orden — no es solo un badge informativo.

> Un producto puede tener **a lo sumo una promo activa** a la vez (el backend lo valida y devuelve
> `409` si se intenta vincular una segunda). No hay rango de fechas/agendado en esta versión: una
> promo está simplemente activa o inactiva (`isActive`), sin "arranca el / termina el".
>
> Recordá las dos apps (ver [FRONTEND_INTEGRATION.md](FRONTEND_INTEGRATION.md)): el **alta/edición de
> promos** es exclusivo del **Panel Admin** (rutas `/promos`, sin prefijo, cookie); el **Storefront**
> solo lee el resultado (precio ya descontado en el carrito, badge informativo en la ficha de
> producto) — no tiene UI de gestión.

---

## 1. Modelo

| Modelo | Campo | Tipo | Notas |
|---|---|---|---|
| `Promo` | `id`, `name`, `description` | — | `description` opcional |
| | `isActive` | boolean | default `true`. Si está en `false`, no se aplica en pricing aunque tenga tiers/productos |
| | `tiers` | `PromoTier[]` | ≥1, ordenados por `minQty` ascendente |
| | `products` | `{ productId, product: { id, name, img } }[]` | ≥1 |
| `PromoTier` | `minQty` | int > 0 | cantidad mínima del escalón |
| | `discountPercentage` | number, `(0, 100)` exclusivo | % de descuento de ese escalón |
| `PromoProduct` | `productId` | int | producto vinculado — debe ser `type: "PRODUCTO"`, nunca `COMBO` |

Regla de escalones: se aplica el de **mayor `minQty`** que la cantidad todavía cumple (3 unidades con
tiers `[3→10%, 5→20%]` da 10%; 5 unidades da 20%; 2 unidades no da ningún descuento). Al crear/editar,
el backend exige `minQty` únicos y **`discountPercentage` creciente junto con `minQty`** (un tier de
menor cantidad no puede tener mayor descuento que uno de mayor cantidad) — replicá esta validación en
el form para no depender del roundtrip al server.

---

## 2. Endpoints admin (`/promos`, cookie, roles ADMIN/STAFF para escritura)

### Listar / filtrar

`GET /promos?productId=1&isActive=true&limit=10&offset=0` — todos los parámetros son opcionales.
Para la pestaña de producto (ver §4) filtrá por `productId` para traer la promo de ESE producto.

```json
[
  {
    "id": 1,
    "name": "Descuento por cantidad - Remera oversize",
    "description": null,
    "isActive": true,
    "createdAt": "2026-07-23T05:47:25.650Z",
    "tiers": [
      { "id": 1, "minQty": 3, "discountPercentage": 10 },
      { "id": 2, "minQty": 5, "discountPercentage": 20 }
    ],
    "products": [
      { "id": 1, "productId": 1, "product": { "id": 1, "name": "Remera oversize studio", "img": "https://..." } }
    ]
  }
]
```

### Detalle

`GET /promos/:id` — mismo shape que un elemento del listado. `404 PROMO_NOT_FOUND` si no existe.

### Crear

`POST /promos`

```json
{
  "name": "Descuento por cantidad - Remera oversize",
  "description": null,
  "isActive": true,
  "tiers": [
    { "minQty": 3, "discountPercentage": 10 },
    { "minQty": 5, "discountPercentage": 20 }
  ],
  "productIds": [1]
}
```

`201` con el objeto completo (mismo shape que el detalle). `isActive` es opcional (default `true`).

### Editar

`PATCH /promos/:id` — mismo body que crear, todo opcional. **`tiers`/`productIds` ausentes = no se
tocan; si vienen, reemplazan la lista completa** (no hay merge incremental — mandá siempre el array
completo de tiers/productos que querés que quede, no solo lo que cambió).

```json
{ "isActive": false }
```

```json
{
  "tiers": [
    { "minQty": 3, "discountPercentage": 10 },
    { "minQty": 5, "discountPercentage": 20 },
    { "minQty": 10, "discountPercentage": 30 }
  ]
}
```

### Eliminar

`DELETE /promos/:id` — hard delete, sin bloqueos (a diferencia de categorías, una promo no tiene nada
que dependa de ella: el descuento ya quedó "horneado" como precio final en las órdenes pasadas, así
que borrarla nunca las afecta retroactivamente). `200 { "message": "Promoción eliminada" }`.

### Errores

| Código | Status | Cuándo |
|---|---|---|
| `PROMO_NOT_FOUND` | 404 | el `:id` no existe o no es del tenant |
| `PRODUCT_NOT_FOUND` | 404 | algún `productIds[]` no existe o no es del tenant (`details.productIds`) |
| `PROMO_PRODUCT_TYPE_NOT_ALLOWED` | 400 | algún `productIds[]` corresponde a un `type: "COMBO"` (`details.productIds`) |
| `PROMO_PRODUCT_ALREADY_LINKED` | 409 | alguno de los productos ya tiene otra promo activa (`details: { productId, conflictingPromoId }`) |
| `PROMO_TIER_DUPLICATE_MINQTY` | 400 | dos tiers con el mismo `minQty` |
| `PROMO_TIER_NOT_INCREASING` | 400 | `discountPercentage` no crece junto con `minQty` |

Shape estándar `{ "error": { "message", "code", "details"? } }`.

---

## 3. Lectura de promo aplicada (producto, carrito, orden)

### Detalle de producto — `activePromo`

`GET /products/:id` (Panel Admin) y `GET /store/products/:id` (Storefront) devuelven, además de los
campos habituales, `activePromo`:

```json
{
  "id": 1,
  "name": "Remera oversize studio",
  "activePromo": {
    "id": 1,
    "name": "Descuento por cantidad - Remera oversize",
    "tiers": [
      { "id": 1, "minQty": 3, "discountPercentage": 10 },
      { "id": 2, "minQty": 5, "discountPercentage": 20 }
    ]
  }
}
```

`activePromo: null` si el producto no tiene ninguna promo activa vinculada. **Storefront**: usalo para
mostrar un badge/leyenda en la ficha del producto ("Llevando 3+, 10% off — 5+, 20% off"), armado a
partir de `tiers` (ordenados ascendente, ya vienen así).

### Carrito — `originalPrice` / `price` / `promo`

`GET /cart` (Panel Admin) y `GET /store/cart` (Storefront): cada línea de `products[]` gana dos campos
nuevos y cambia el significado de `price`:

```json
{
  "products": [
    {
      "product": { "id": 1, "name": "Remera oversize studio", "type": "PRODUCTO", "img": "https://..." },
      "variant": { "id": 1, "attributes": { "color": "#000000", "talle": "S" }, "sku": "TEE-STD-BLK-S" },
      "originalPrice": 14990,
      "price": 13491,
      "promo": { "minQty": 3, "discountPercentage": 10 },
      "stock": 40,
      "quantity": 2
    }
  ]
}
```

- `originalPrice`: precio de lista, sin descuento (campo nuevo).
- `price`: precio efectivo por unidad — **ya viene con el descuento aplicado** si corresponde (antes
  era siempre igual a `originalPrice`; si el front multiplicaba `price * quantity` para el subtotal de
  línea, sigue funcionando igual, ahora da el subtotal correcto con descuento).
- `promo`: `{ minQty, discountPercentage }` del escalón aplicado, o `null` si no corresponde ninguno
  (por ejemplo, el producto tiene promo pero la cantidad en el carrito no alcanza el primer escalón).
- La cantidad que decide el escalón es la **suma de todas las variantes del mismo producto** en el
  carrito — si el cliente tiene 2 unidades del talle S y 2 del talle M del mismo producto, ambas líneas
  muestran el descuento correspondiente a 4 unidades, no a 2.
- No hay un total de carrito con descuento expuesto todavía (el carrito no expone un total en general,
  solo precio por línea) — si el front necesita un total, sumalo en cliente con `price * quantity` de
  cada línea.

Sugerencia de UI: mostrar `originalPrice` tachado + `price` destacado cuando `promo != null`, y un
mensaje tipo "Agregá {N} más y llevate {siguiente descuento}%" cuando la cantidad está por debajo del
próximo escalón (calculable en cliente comparando `quantity` contra los `tiers` de `activePromo` del
producto).

### Orden — el precio ya viene descontado, sin campo nuevo

`POST /orders`, `GET /orders`, `GET /orders/:id`, etc.: `productos[].precio` **ya es el precio final
con descuento aplicado** (snapshot al momento de la compra) — no hay campo `originalPrice` a nivel
orden, es el mismo contrato de siempre. Si necesitás mostrar "tenía descuento" en el detalle de una
orden pasada, no hay forma de recuperar el precio de lista original desde la orden (es intencional: el
histórico de precios no cambia aunque la promo se edite o borre después).

---

## 4. UI del Panel Admin: pestaña "Promos" en el formulario de producto

Agregar una nueva pestaña **"Promos"** en el panel de alta/edición de producto, **debajo de
"Variantes"**. Solo debe estar disponible para productos `type: "PRODUCTO"` — ocultarla (o
deshabilitarla con un tooltip "No disponible para combos") cuando `type === "COMBO"`, igual criterio
que ya se usa para mostrar/ocultar la pestaña de combo-options.

Como el modelo de `Promo` es multi-producto pero esta pestaña vive en el contexto de UN producto, la
UX recomendada es una vista simplificada que oculta esa generalidad:

1. **Al abrir la pestaña**: pedí `GET /products/:id` (ya lo tenés cargado en el resto del form) y leé
   `activePromo`.
   - `activePromo: null` → mostrar estado vacío ("Este producto no tiene descuento por cantidad") +
     botón "Crear descuento".
   - `activePromo` presente → mostrar los tiers actuales en una tabla editable + botón "Guardar
     cambios" + opción "Desactivar" / "Eliminar".
2. **Crear** (`activePromo == null`): un builder de escalones (lista de filas `{ cantidad mínima, %
   descuento }`, botón "+ Agregar escalón", mínimo 1 fila) + al guardar:
   ```json
   POST /promos
   { "name": "<nombre del producto> - descuento por cantidad", "tiers": [...], "productIds": [<id del producto actual>] }
   ```
   El `name` se puede autogenerar (como en el ejemplo) sin pedírselo al usuario — es solo un label
   interno para el listado de promos, no se muestra al cliente final. Si más adelante se quiere una
   pantalla aparte de "Promociones" que gestione promos multi-producto, ese `name` es lo que
   identificaría cada una en esa lista.
3. **Editar** (`activePromo` presente): mismo builder de escalones precargado con
   `activePromo.tiers`, guardar con:
   ```json
   PATCH /promos/:id
   { "tiers": [...] }
   ```
   (no mandes `productIds` acá — al no mandarlo, el vínculo con este producto queda intacto; si lo
   mandaras, reemplazarías la lista completa de productos de la promo, probablemente desvinculando
   este producto si te olvidás de incluirlo).
4. **Desactivar/reactivar**: toggle que hace `PATCH /promos/:id { "isActive": false | true }` — útil
   para pausar el descuento sin perder los tiers configurados. Al reactivar, si el producto ya quedó
   enganchado a otra promo activa mientras tanto, el backend devuelve `409
   PROMO_PRODUCT_ALREADY_LINKED` — mostrar ese error tal cual (no debería pasar en el flujo normal de
   esta pestaña, ya que es 1 promo por producto, pero puede darse si se gestiona la misma promo desde
   dos pestañas/pestañas de producto abiertas en paralelo).
5. **Eliminar**: `DELETE /promos/:id` con confirmación (mensaje: "Se va a eliminar el descuento por
   cantidad de este producto. Las órdenes ya facturadas con este descuento no se modifican.").
6. **Validación en cliente** (replicá las reglas del backend para no ida-y-vuelta):
   - Al menos 1 escalón.
   - `minQty` enteros positivos, sin repetidos.
   - `discountPercentage` en `(0, 100)` exclusivo.
   - Ordenar por `minQty` y verificar que `discountPercentage` sea estrictamente creciente — marcar el
     error en la fila que rompe el orden, no solo un mensaje genérico.
7. Después de crear/editar/eliminar, invalidá el cache local del detalle de producto (`GET
   /products/:id`) si tu store lo cachea — el campo `activePromo` cambia sin que cambie el resto del
   producto.

> Nota: si en el futuro se quiere soportar "una promo con varios productos" desde la UI (hoy el backend
> ya lo soporta, `productIds` acepta un array), esta pestaña simplificada seguiría funcionando para el
> caso 1-producto; una pantalla aparte de gestión de promos (fuera del form de producto) sería el lugar
> natural para armar/editar promos multi-producto con un picker de productos.

---

## 5. Checklist de verificación

- [ ] Crear un producto `type: "PRODUCTO"` con 2 variantes → pestaña "Promos" visible, debajo de
      "Variantes"; en un producto `type: "COMBO"` la pestaña no está disponible.
- [ ] Crear un descuento con tiers `[3→10%, 5→20%]` desde la pestaña → `201`, la tabla de escalones se
      recarga con los datos guardados.
- [ ] Agregar al carrito 2 unidades de una variante + 2 de otra variante del mismo producto (4 en
      total) → ambas líneas de `GET /cart` muestran `price` con 10% off y `promo.minQty === 3`.
- [ ] Subir a 5 unidades totales (sumando variantes) → pasa a 20% off.
- [ ] Bajar a 2 unidades → `promo: null`, `price === originalPrice`.
- [ ] Completar el checkout (`POST /orders`) → el total de la orden y cada línea reflejan el precio ya
      descontado.
- [ ] Intentar crear una segunda promo activa sobre el mismo producto → `409
      PROMO_PRODUCT_ALREADY_LINKED`, mostrado como error legible en el form.
- [ ] Intentar armar tiers con `%` decreciente a medida que crece la cantidad → bloqueado en cliente
      (y si se fuerza, `400 PROMO_TIER_NOT_INCREASING` del server).
- [ ] Desactivar la promo (`isActive: false`) → el carrito deja de aplicar el descuento sin borrar los
      escalones configurados; reactivarla la vuelve a aplicar.
- [ ] Eliminar la promo → `GET /products/:id` pasa a `activePromo: null` inmediatamente.
- [ ] Ficha de producto en el storefront (`GET /store/products/:id`) → `activePromo` disponible para
      mostrar el badge, sin necesitar login.

---

## 6. Ejemplos curl

```bash
# Crear una promo sobre el producto 1 (Panel Admin)
curl -X POST --cookie "access_token=<jwt-admin>" -H "Content-Type: application/json" \
  -d '{"name":"Remera oversize - por cantidad","tiers":[{"minQty":3,"discountPercentage":10},{"minQty":5,"discountPercentage":20}],"productIds":[1]}' \
  http://localhost:4000/promos

# Ver la promo activa de un producto (público, storefront)
curl "http://localhost:4000/store/products/1" -H "X-Tenant-Slug: acme" | jq .activePromo

# Ver el precio con descuento en el carrito (storefront, cliente logueado)
curl "http://localhost:4000/store/cart" -H "X-Tenant-Slug: acme" -H "Authorization: Bearer <jwt-customer>"

# Editar solo los escalones, sin tocar los productos vinculados
curl -X PATCH --cookie "access_token=<jwt-admin>" -H "Content-Type: application/json" \
  -d '{"tiers":[{"minQty":3,"discountPercentage":10},{"minQty":5,"discountPercentage":20},{"minQty":10,"discountPercentage":30}]}' \
  http://localhost:4000/promos/1
```

---

## 7. Resumen

- Nueva pestaña **"Promos"** en el form de producto, debajo de "Variantes", solo para
  `type: "PRODUCTO"`. Vista simplificada 1-producto sobre el modelo real (`Promo` con `tiers[]` y
  `productIds[]`) — crea/edita con `productIds: [<este producto>]` fijo.
- CRUD completo en `/promos` (cookie, ADMIN/STAFF) — ver §2 para shapes y errores.
- El descuento se refleja solo leyendo campos nuevos que ya vienen en endpoints existentes: `activePromo`
  en `GET /products/:id` y `GET /store/products/:id` (§3), y `originalPrice`/`price`/`promo` por línea
  en `GET /cart`/`GET /store/cart` (§3) — no hace falta ningún endpoint nuevo del lado de consumo.
  `price` en el carrito ya viene con el descuento aplicado; en la orden, `productos[].precio` también.
- Un producto tiene a lo sumo una promo activa; la cantidad que dispara el escalón suma **todas las
  variantes** del producto, no cada una por separado.
