---
lado: contrato
---

# Guía frontend: tipos de producto (UNIDAD / VARIANTE / COMBO)

Breaking change grande: `Product` pasa a tener un **tipo explícito** (`type`). Reemplaza toda la
lógica implícita anterior ("¿tiene variantes o no?", `isCombo` booleano) por un solo campo, y **cambia
las rutas de carrito** (dejan de ser por `variantId`, pasan a ser por `productId`).

> Recordá las dos apps (ver [FRONTEND_INTEGRATION.md](FRONTEND_INTEGRATION.md)): esto toca **Panel
> Admin** (alta/edición de producto) y **ambas apps** para carrito/checkout (Panel Admin y
> Storefront).

---

## 1. `Product.type`: los tres tipos

| Tipo | Precio | Stock | Variantes | Ejemplo |
|---|---|---|---|---|
| `UNIDAD` | `Product.price` | `Product.stock` | ninguna | Torta, producto sin color/talle |
| `VARIANTE` | por variante | por variante | ≥1 (`variants[]`) | Remera con color/talle |
| `COMBO` | `Product.price` (fijo) | sin stock propio | ninguna | Ver [FRONTEND_COMBOS.md](FRONTEND_COMBOS.md) |

`type` es **obligatorio** al crear un producto (`POST /products`) y determina qué otros campos son
válidos/requeridos:

- `UNIDAD` → requiere `stock`, rechaza `variants` (`400 VARIANTS_NOT_ALLOWED` si mandás alguna).
- `VARIANTE` → requiere `variants` no vacío (`400 VARIANTS_REQUIRED` si viene `[]`), rechaza `stock`
  a nivel producto.
- `COMBO` → requiere `comboMinItems`/`comboMaxItems`/`comboOptions`, rechaza `variants`. Ver
  [FRONTEND_COMBOS.md](FRONTEND_COMBOS.md) para el resto del contrato de combos.

```json
// POST /products — UNIDAD
{ "name": "Torta de chocolate", "price": 8000, "type": "UNIDAD", "stock": 5 }

// POST /products — VARIANTE
{
  "name": "Remera básica", "price": 4500, "type": "VARIANTE",
  "variants": [{ "color": "#000000", "size": "M", "stock": 10 }]
}
```

### Form de alta/edición: sugerencia de UX
1. Selector de tipo (radio/tabs): "Producto simple" (UNIDAD) / "Con variantes" (VARIANTE) / "Combo"
   (COMBO). `TenantConfig.productVariantsEnabled` (sin cambios, ver doc previa) sigue siendo la señal
   para qué tipo ofrecer por default a un tenant sin variantes reales (ej. Mesa Dulce).
2. Según el tipo elegido, mostrar el form correspondiente: input de `stock` (UNIDAD), builder de
   variantes (VARIANTE), o el form de combo (COMBO, ver la otra guía).

## 2. Editar el tipo de un producto existente

`PATCH /products/:id` con un `type` distinto al actual **dispara una transición**: los datos que dejan
de aplicar se **desactivan en el backend** (nunca se borran, por las órdenes históricas que puedan
referenciarlos) — el front no tiene que hacer nada especial para eso, pero sí tiene que saber que:

- Pasar de `VARIANTE` a `UNIDAD`/`COMBO` exige mandar `stock` (si es `UNIDAD`) en el mismo request —
  si no, `400 STOCK_REQUIRED`.
- Pasar a `VARIANTE` exige mandar `variants` no vacío en el mismo request (si el producto no tenía ya
  variantes activas) — si no, `400 VARIANTS_REQUIRED`.
- No hay confirmación extra a nivel API — si el form permite cambiar el tipo de un producto con
  historial de ventas, considerá agregar una confirmación en el cliente ("esto va a desactivar las
  variantes actuales") antes de mandar el PATCH.

## 3. Carrito: las rutas cambian de `:variantId` a `:productId`

**Breaking change.** Antes: `POST /cart/:variantId`. Ahora: `POST /cart/:productId`, con `variantId`
opcional en el **body** (solo si el producto es VARIANTE).

```json
// POST /cart/45   (producto UNIDAD, ej. torta)
{}

// POST /cart/12   (producto VARIANTE, ej. remera)
{ "variantId": 108 }
```

| Método | Ruta (antes) | Ruta (ahora) | Body |
|---|---|---|---|
| POST | `/cart/:variantId` | `/cart/:productId` | `{ variantId? }` |
| PATCH | `/cart/:variantId` | `/cart/:productId` | `{ variantId? }` |
| POST | `/cart/combo/:variantId` | `/cart/combo/:productId` | ver [FRONTEND_COMBOS.md](FRONTEND_COMBOS.md) |

Aplica a **ambas apps**: `routes/cart.js` (Panel Admin) y `routes/store/cart.js` (Storefront).

> [!warning] `PATCH` (restar 1 unidad) no es simétrico con `POST`
> Si un producto VARIANTE tiene dos líneas activas en el carrito (ej. remera roja + remera azul),
> `variantId` es **obligatorio** en el body del `PATCH` para saber cuál línea decrementar — sin él, el
> backend no encuentra ninguna línea que matchee (`variantId: null`) y responde
> `404 PRODUCT_NOT_IN_CART`. En `POST` en cambio `variantId` siempre es opcional-pero-recomendado (si
> el producto es VARIANTE y no lo mandás, el backend responde `400 VARIANT_REQUIRED`).

### `GET /cart` — shape de cada línea

```json
{
  "products": [
    {
      "product": { "id": 12, "name": "Remera básica", "type": "VARIANTE", "img": "https://..." },
      "variant": { "id": 108, "color": "#000", "size": "M", "sku": "ACM-REM-NM" },
      "price": 4500,
      "stock": 10,
      "img": "https://...",
      "quantity": 2,
      "comboSelection": null
    }
  ]
}
```

`variant: null` para líneas UNIDAD/COMBO. `stock` puede ser `null` para COMBO (no tiene stock propio).

### Errores nuevos/relevantes en carrito

| Código | Status | Cuándo |
|---|---|---|
| `PRODUCT_NOT_FOUND` | 404 | el `:productId` no existe o no es del tenant |
| `VARIANT_REQUIRED` | 400 | el producto es VARIANTE y no mandaste `variantId` |
| `PRODUCT_IS_COMBO` | 400 | intentaste `POST /cart/:productId` sobre un combo — usá `/cart/combo/:productId` |
| `PRODUCT_NOT_IN_CART` | 404 | `PATCH` sin encontrar la línea (ver nota de arriba sobre `variantId`) |

## 4. Detalle de orden: `productId` en cada línea

`productos[]` en las respuestas de orden (`POST /orders`, `GET /orders`, `GET /orders/all`,
`GET /orders/:id`, `POST /orders/:id/review`) ahora trae **`productId`** además de `variantId`
(`variantId: null` para líneas UNIDAD/COMBO):

```json
{
  "productos": [
    { "id": 501, "productId": 45, "variantId": null, "nombre": "Torta de chocolate", "cantidad": 1, "precio": 8000, "color": null, "size": null, "note": null, "combo": null }
  ]
}
```

No hay que cambiar nada si el front ya usaba `variantId` como opcional/nullable en el render — el
cambio es aditivo (`productId` nuevo) salvo que el código asumiera `variantId` siempre no-nulo.

## 5. Checklist de verificación

- [ ] Crear un producto `UNIDAD` sin `variants` → `201`, `stock` queda en el producto (no en una
      variante oculta).
- [ ] Crear un producto `VARIANTE` sin `variants` → `400 VARIANTS_REQUIRED`.
- [ ] Crear un producto `UNIDAD` con `variants` no vacío → `400 VARIANTS_NOT_ALLOWED`.
- [ ] Editar un producto `VARIANTE` pasándolo a `UNIDAD` sin `stock` → `400 STOCK_REQUIRED`; con
      `stock` → `200`, las variantes reales quedan desactivadas (no aparecen más en `GET /variants/:productId`
      activas, pero no se borraron).
- [ ] Agregar un producto UNIDAD al carrito (`POST /cart/:productId`, body vacío) → `201`.
- [ ] Agregar un producto VARIANTE al carrito sin `variantId` → `400 VARIANT_REQUIRED`.
- [ ] Con dos variantes del mismo producto en el carrito, `PATCH /cart/:productId` sin `variantId` →
      `404 PRODUCT_NOT_IN_CART` (hay que mandar cuál).
- [ ] `GET /orders/:id` → cada línea trae `productId` no-nulo, `variantId` nulo si UNIDAD/COMBO.

## 6. Ejemplos curl

```bash
# Crear producto UNIDAD
curl -X POST --cookie "access_token=<jwt-admin>" \
  -F "name=Torta de chocolate" -F "price=8000" -F "type=UNIDAD" -F "stock=5" \
  http://localhost:4000/products

# Agregar producto UNIDAD al carrito (storefront)
curl -X POST "http://localhost:4000/store/cart/45" \
  -H "X-Tenant-Slug: mesa-dulce" -H "Authorization: Bearer <jwt-customer>"

# Agregar producto VARIANTE al carrito (storefront)
curl -X POST "http://localhost:4000/store/cart/12" \
  -H "X-Tenant-Slug: mesa-dulce" -H "Authorization: Bearer <jwt-customer>" \
  -H "Content-Type: application/json" -d '{"variantId":108}'
```

## 7. Resumen

- `Product.type` (`UNIDAD | VARIANTE | COMBO`) es requerido al crear, reemplaza `isCombo` y toda
  heurística implícita anterior.
- Cambiar `type` en un `PATCH` dispara una transición server-side (desactiva lo que deja de aplicar,
  nunca borra).
- **Las rutas de carrito cambian de `:variantId` a `:productId`**, con `variantId` opcional en el
  body — breaking change en las tres rutas (`POST`, `PATCH`, `POST /combo`).
- `OrderItem`/líneas de orden ganan `productId` (siempre presente); `variantId` ahora es nullable.
