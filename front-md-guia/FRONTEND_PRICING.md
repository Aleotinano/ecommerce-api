---
lado: contrato
---

# Guía Frontend — Precio de producto (global) y por variante

Cómo el frontend debe leer, mostrar y enviar precios. Complementa a
[`FRONTEND_INTEGRATION.md`](./FRONTEND_INTEGRATION.md) (auth, tenants, ruteo).

---

## 1. El modelo en una frase

> **Precio efectivo = `variant.price` si existe, si no `product.price`.**

El **producto siempre tiene precio** (`product.price` es **obligatorio**). Cada
variante **puede** tener su propio precio como override; si no lo tiene
(`price: null`), hereda el precio del producto. Como el producto siempre tiene
precio, **el precio efectivo nunca es `null`** (siempre hay algo que cobrar).

| Caso | `product.price` | `variant.price` | Precio que se cobra |
|------|-----------------|-----------------|---------------------|
| Variante con precio propio | 2000 | 3500 | **3500** (gana la variante) |
| Variante hereda del producto | 3500 | `null` | **3500** (producto) |
| Producto unitario | 4200 | `null` | **4200** |

> Ojo con el `0`: un precio de `0` es válido y **no** activa el fallback.
> El fallback solo ocurre cuando el valor es `null`/`undefined`.

La regla está implementada en el backend en
[`helpers/price.js`](./helpers/price.js) y se aplica en carrito, total de orden y
`OrderItem.price`. El frontend debe **espejar exactamente** esta misma regla para
mostrar precios coherentes antes de que el ítem llegue al backend.

---

## 2. Helper de referencia (copiar al front)

```js
// utils/price.js
// Espejo de helpers/price.js del backend.
export function getEffectivePrice(variant, product) {
  if (variant?.price != null) return variant.price; // null/undefined -> fallback
  if (product?.price != null) return product.price;
  return null; // sin precio: producto no comprable
}
```

---

## 3. Mostrar precios en listado y detalle

Tanto el listado (`GET /store/products`) como el detalle (`GET /store/products/:id`)
devuelven el producto con su `price` y un array `variants`, cada variante con su
`price` (que puede ser `null`).

```js
// Calcula qué mostrar para una card de producto.
function priceLabel(product, currency = "ARS") {
  const fmt = (n) =>
    new Intl.NumberFormat("es-AR", { style: "currency", currency }).format(n);

  const variants = product.variants ?? [];

  // Producto unitario (sin variantes): solo el precio del producto.
  if (variants.length === 0) {
    return product.price != null ? fmt(product.price) : "Consultar";
  }

  // Precio efectivo de cada variante.
  const prices = variants
    .map((v) => getEffectivePrice(v, product))
    .filter((p) => p != null);

  if (prices.length === 0) return "Consultar";

  const min = Math.min(...prices);
  const max = Math.max(...prices);

  // Todas iguales -> un solo precio. Distintas -> rango "Desde …".
  return min === max ? fmt(min) : `Desde ${fmt(min)}`;
}
```

**Reglas de UI sugeridas:**

- **Una sola variante o todas con el mismo precio efectivo** → mostrar un precio único.
- **Variantes con precios distintos** → mostrar `"Desde $X"` en la card y el precio
  exacto al seleccionar color/talla en el detalle.
- **Precio efectivo `null`** ya no debería pasar (el producto siempre tiene
  precio). El helper igual lo contempla de forma defensiva: si llegara a pasar,
  mostrá `"Consultar"` y deshabilitá la compra.

En el **detalle**, al elegir una variante recalculá con `getEffectivePrice(variant, product)`
para reflejar el precio real de esa combinación.

---

## 4. Crear / editar productos (Panel Admin)

El campo `price` del producto es **obligatorio** (> 0). Las variantes aceptan
`price` **opcional/nullable** como override.

### Producto con variantes que comparten precio global

```http
POST /products
Content-Type: application/json
```
```json
{
  "name": "Remera lisa",
  "price": 3500,
  "variants": [
    { "color": "negro", "size": "M", "stock": 10 },
    { "color": "blanco", "size": "L", "stock": 5 }
  ]
}
```
Las variantes sin `price` heredan los **3500** del producto.

### Producto con override por variante

```json
{
  "name": "Buzo",
  "price": 8000,
  "variants": [
    { "color": "gris", "size": "M", "stock": 10 },
    { "color": "edición especial", "size": "L", "stock": 2, "price": 12000 }
  ]
}
```
La primera hereda **8000**; la segunda cuesta **12000**.

### Producto unitario (sin variantes)

```json
{ "name": "Taza de cerámica", "price": 4200 }
```

### Editar el precio global

```http
PATCH /products/:id
```
```json
{ "price": 4800 }
```

### Notas de validación

- `price` del **producto** es **obligatorio** y debe ser **> 0**. Si lo omitís al
  crear, el backend responde `400`. En `PATCH` no se puede mandar `null`.
- `price` de la **variante** es opcional y nullable (override); debe ser **> 0**
  si se envía, o `null` para heredar del producto.
- `stock` sigue siendo obligatorio en cada variante.

---

## 5. Carrito (`GET /store/cart`)

Cada ítem del carrito ya viene con el precio **resuelto** más el precio crudo de la
variante, para que no tengas que recalcular:

```jsonc
{
  "products": [
    {
      "variant": {
        "id": 84,
        "color": "negro",
        "size": "M",
        "price": 3500,        // ← precio EFECTIVO (variante o fallback al producto)
        "variantPrice": null, // ← precio propio de la variante (null = hereda)
        "stock": 10,
        "sku": "REM-XXX",
        "product": { "id": 12, "name": "Remera lisa", "img": "…" }
      },
      "quantity": 2
    }
  ]
}
```

- Usá **`variant.price`** para mostrar y para calcular el subtotal
  (`price * quantity`). Ya tiene el fallback aplicado.
- `variantPrice` es informativo (p. ej. badge "precio especial" cuando no es null).

---

## 6. Órdenes

Al crear la orden, el backend recalcula todo del lado servidor:

- `Order.total` usa el precio efectivo de cada ítem.
- Cada `OrderItem.price` se guarda **ya resuelto** (variante o producto). El front
  no necesita enviar precios; solo variantes y cantidades.

> El precio nunca se confía desde el cliente: el backend siempre recalcula con
> [`helpers/price.js`](./helpers/price.js).

---

## 7. Filtro por precio (`minPrice` / `maxPrice`)

El listado (`GET /store/products?minPrice=…&maxPrice=…`) filtra por **precio
efectivo**, así que entran también:

- Variantes con precio propio dentro del rango.
- Variantes sin precio cuyo **producto** cae en el rango.
- **Productos unitarios** (sin variantes) cuyo `product.price` cae en el rango.

Combinable con `variantColor` / `variantSize`. Cuando filtrás por color/talla, los
productos unitarios sin variantes no aplican (no tienen esos atributos).

---

## 8. Checklist de integración

- [ ] Copiar `getEffectivePrice` al front y usarlo en TODO render de precio.
- [ ] Cards: precio único vs `"Desde $X"` vs `"Consultar"`.
- [ ] Detalle: recalcular al seleccionar variante.
- [ ] Carrito: usar `variant.price` (efectivo) para subtotales.
- [ ] Admin: `price` de producto **obligatorio** (> 0) en el form; `price` de
      variante opcional (permitir vaciarlo → `null` para heredar).
- [ ] No enviar precios al crear órdenes; el backend los resuelve.
