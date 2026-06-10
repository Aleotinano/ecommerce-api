# Guía frontend: verificar integridad de "precio de producto obligatorio"

Cambio de backend: **`Product.price` ahora es obligatorio (`> 0`)**. La **variante
sigue con precio opcional** (override). Esta guía es para que el front **adapte y
verifique** que todo sigue íntegro con el nuevo contrato.

Complementa a [FRONTEND_PRICING.md](FRONTEND_PRICING.md) (reglas de precio) y a
[FRONTEND_INTEGRATION.md](FRONTEND_INTEGRATION.md) (auth/tenants).

---

## 1. Qué cambió en el contrato

| Antes | Ahora |
|-------|-------|
| `product.price` podía ser `null` (opcional) | `product.price` **siempre presente** y **> 0** (obligatorio) |
| Crear producto sin precio → quedaba `null` | Crear sin precio → **`400` de validación** |
| `PATCH` podía mandar `price: null` | `PATCH` con `price: null` → **`400`** |
| Precio efectivo podía ser `null` (no comprable) | Precio efectivo **nunca es `null`** (siempre hay precio) |

Sin cambios: `variant.price` sigue **opcional/nullable** (override); `0` sigue
siendo válido; la resolución `variant.price ?? product.price` no cambió.

> Rutas afectadas (Panel Admin, **cookie** httpOnly, rol ADMIN/STAFF, **multipart**):
> `POST /products` y `PATCH /products/:id`. El storefront (`GET /store/products`)
> solo lee y ahora **siempre** trae `price`.

---

## 2. Qué adaptar en el front

1. **Form de alta de producto**: el campo `price` pasa a **requerido** y **> 0**.
   Validá en cliente antes de enviar (no dejes mandar vacío).
2. **Form de edición**: `price` sigue opcional en el `PATCH` (update parcial), pero
   **no permitas vaciarlo** (no mandes `price: null` ni `""`). Si el usuario borra el
   campo, no incluyas `price` en el body en vez de mandarlo nulo.
3. **Envío multipart**: `POST/PATCH /products` van como `multipart/form-data` (por la
   imagen). Mandá `price` como campo de texto; el backend lo castea (`z.coerce`).
4. **Manejo del `400`**: leé `errors.price` para mostrar el mensaje en el campo.
5. **Render**: podés **eliminar** los estados "Consultar" / "sin precio" para el
   precio de producto — ya no ocurren (el helper queda defensivo igual).

### Shape del error de validación (400)

```json
{
  "message": "Error de validacion",
  "errors": {
    "price": ["El precio debe ser un número"]
  }
}
```

- Falta `price` → `errors.price` con `"El precio debe ser un número"` (al coercionar
  `undefined`/`""`).
- `price <= 0` → `"El precio debe ser mayor a 0"`.
- Puede venir más de un campo en `errors`; cada uno es un **array** de mensajes.

---

## 3. Checklist de verificación de integridad

Probalo con un usuario **ADMIN/STAFF** logueado (cookie). Esperado entre paréntesis.

### Alta (`POST /products`)
- [ ] Crear **sin** `price` → **400**, `errors.price` presente. *(form bloquea antes)*
- [ ] Crear con `price = 0` → **400** (`> 0`).
- [ ] Crear con `price = -100` → **400**.
- [ ] Crear con `price = 1500` (+ variantes sin precio) → **201**; las variantes
      heredan 1500.
- [ ] Crear con `price = 1500` y una variante con `price = 2000` → **201**; esa
      variante cuesta 2000, el resto 1500.

### Edición (`PATCH /products/:id`)
- [ ] `PATCH` cambiando solo `name` (sin `price`) → **200**, el precio no se toca.
- [ ] `PATCH` con `price: null` → **400** (no se puede borrar el precio).
- [ ] `PATCH` con `price: 4800` → **200**, precio actualizado.

### Lectura / coherencia
- [ ] `GET /products` y `GET /products/:id` (admin) → **todos** los productos traen
      `price` no nulo.
- [ ] `GET /store/products` (storefront) → ídem; ninguna card debería caer en
      "Consultar" por falta de precio de producto.
- [ ] Carrito (`GET /store/cart`): `variant.price` (efectivo) nunca `null`.
- [ ] Crear una orden y revisar que `OrderItem.price` y `Order.total` cierran con el
      precio efectivo (el backend recalcula; el front no manda precios).

### Datos existentes
- [ ] Productos viejos que antes no tenían precio de producto → ahora muestran un
      precio (se completó en backend; pueden quedar en `0` si no había de dónde
      derivarlo: revisalos y corregilos desde el panel si hace falta).

---

## 4. Snippets

### Validación en el form (alta)

```js
function validateProductForm({ price }) {
  const errors = {};
  const n = Number(price);
  if (price === "" || price == null || Number.isNaN(n)) {
    errors.price = "El precio es requerido";
  } else if (n <= 0) {
    errors.price = "El precio debe ser mayor a 0";
  }
  return errors;
}
```

### Edición: no mandar precio nulo/vacío

```js
function buildUpdateBody(form) {
  const body = { name: form.name /* ...otros campos */ };
  // Incluí price SOLO si tiene un valor válido > 0; nunca null/"".
  const n = Number(form.price);
  if (form.price !== "" && form.price != null && !Number.isNaN(n) && n > 0) {
    body.price = n;
  }
  return body;
}
```

### Manejo del 400

```js
const res = await fetch("/products", {
  method: "POST",
  credentials: "include",
  body: formData, // multipart/form-data con la imagen + price como campo
});

if (res.status === 400) {
  const { errors } = await res.json();
  // errors.price?.[0] -> mensaje a mostrar bajo el input de precio
  setFieldError("price", errors?.price?.[0]);
  return;
}
```

### curl de humo

```bash
# Sin precio -> 400
curl -X POST --cookie "access_token=<jwt-admin>" \
  -F "name=Test sin precio" \
  http://localhost:4000/products

# Con precio -> 201
curl -X POST --cookie "access_token=<jwt-admin>" \
  -F "name=Test con precio" -F "price=1500" \
  http://localhost:4000/products

# PATCH intentando nulear precio -> 400
curl -X PATCH --cookie "access_token=<jwt-admin>" \
  -H "Content-Type: application/json" \
  -d '{"price": null}' \
  http://localhost:4000/products/1
```

---

## 5. Resumen

- `price` de producto **obligatorio** (`> 0`): adaptá el form de alta y no permitas
  vaciarlo en edición.
- Manejá el `400` leyendo `errors.price`.
- El precio efectivo **ya nunca es `null`** → podés simplificar el render (sin
  "Consultar" por falta de precio de producto).
- La variante **no cambió**: sigue opcional como override.
