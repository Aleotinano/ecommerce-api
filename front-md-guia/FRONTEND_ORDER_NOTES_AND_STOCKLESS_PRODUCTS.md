---
lado: contrato
---

# Guía frontend: nota por línea de pedido + productos sin variantes

Dos cambios de backend independientes, agrupados en una misma guía porque salen en el
mismo release:

1. **Nota por línea de producto** (`OrderItem.note`) — observación libre por ítem del
   pedido (ej. "sin nueces", "dedicatoria: Juan"), distinta de la nota de la orden.
2. **Productos sin variantes** (`stock` en alta de producto) — permite crear productos
   vendibles sin cargar color/talle (ej. "Mesa Dulce").

> Recordá las dos apps (ver [FRONTEND_INTEGRATION.md](FRONTEND_INTEGRATION.md)): estos
> dos cambios son **Panel Admin** (rutas sin prefijo, cookie httpOnly, rol ADMIN/STAFF).

---

## 1. Nota por línea de producto (`note`)

### Qué cambió

| Antes | Ahora |
|-------|-------|
| `OrderItem` no tenía observaciones por línea | `OrderItem.note`: string opcional, **máx 150 caracteres**, nullable |
| Una orden no podía tener 2 líneas de la misma variante (`unique([orderId, variantId])`) | Esa unicidad se quitó: **puede haber 2+ líneas de la misma variante** si difieren en `note` |

No confundir con la nota de la orden (`PATCH /orders/:id` → `note`, máx 500, queda en
el timeline de estado). Son dos campos distintos en dos niveles distintos.

### Dónde aparece en las respuestas

Cada item de `productos[]` ahora trae **`id` y `variantId`**, además de `note`, en
**todas** las respuestas de orden: `POST /orders`, `GET /orders`, `GET /orders/all`,
`GET /orders/:id`, `POST /orders/:id/review`. `id` es el **id de la fila** (`OrderItem.id`)
— es la clave que hay que usar para editar esa línea puntual, no `variantId` (ver por
qué en la sección siguiente).

```json
{
  "productos": [
    {
      "id": 231,
      "variantId": 12,
      "nombre": "Torta de cumpleaños",
      "cantidad": 1,
      "precio": 9000,
      "color": null,
      "size": null,
      "note": "Dedicatoria: Feliz cumple Juan"
    }
  ]
}
```

### GET /orders/:id para ADMIN/STAFF: ahora sí trae cualquier orden del tenant

Antes había un bug: `GET /orders/:id` filtraba por el `userId` del que llama, y como
las órdenes BOT nacen con `userId: null`, un admin nunca podía traer el detalle de un
draft de WhatsApp por esta vía (**404 siempre**). Ya está arreglado: si el usuario logueado
es `ADMIN`/`STAFF`, la ruta devuelve cualquier orden del tenant (incluidas las BOT); el
resto de los roles sigue viendo solo sus propias órdenes. Usá esta ruta para cargar el
detalle **antes** de abrir la pantalla de revisión (necesitás el `id` de cada línea).

### Dónde se manda (`POST /orders/:id/review`)

Endpoint de **revisión admin de pedidos BOT** (draft creado por WhatsApp, corrección
inline antes de confirmar). Body:

```json
{
  "items": [
    { "id": 231, "quantity": 2, "note": "sin nueces" },
    { "id": 232, "quantity": 1, "note": "sin nueces ni pasas" }
  ]
}
```

- **`id` es el `OrderItem.id`, no `variantId`.** Como ya no hay unicidad
  `[orderId, variantId]`, dos líneas de la orden pueden compartir `variantId` (mismo
  producto, distinta nota) — `variantId` dejó de ser una clave única por fila. Sacá el
  `id` de la respuesta de `GET /orders/:id` (o del `review` anterior) y mandalo tal
  cual, no lo inventes ni lo derives del índice del array.
- `quantity`: entera, > 0.
- `note`: opcional, `null` o string ≤150 caracteres. Si no mandás la clave `note`, el
  backend mantiene la que ya tenía esa línea; si mandás `note: null`, la borra.
- No hace falta mandar todas las líneas de la orden — solo las que se editan. Las que
  no aparecen en `items[]` quedan sin cambios.

### Ajustes en el front

1. **Pantalla de revisión de pedido BOT** (`POST /orders/:id/review`):
   - Traer el detalle con `GET /orders/:id` primero (ya no da 404 para BOT/admin) y
     guardar el `id` de cada línea junto al resto de sus datos en el estado del form.
   - Agregar un input de texto corto (150 chars, con contador) por cada línea,
     prellenado con la `note` que ya trae el item.
   - Permitir vaciarlo — mandar `note: null` es válido para borrarla; si no tocás el
     campo, no incluyas `note` en esa línea del body (así no la pisás sin querer).
   - **No agrupar ni indexar líneas por `variantId`.** El mismo producto puede aparecer
     en 2 filas con notas distintas (ej. dos combos con relleno diferente). Cada fila
     se identifica y se edita por su `id`, punto.
   - Armá el body de `review` solo con las líneas que el usuario efectivamente tocó,
     usando el `id` de cada una.
2. **Detalle de orden** (admin y storefront): mostrar `note` como texto secundario
   debajo de color/talle en la card o fila del producto, cuando no sea `null`.
3. **Listado admin** (`GET /orders/all`): si el listado muestra un resumen de
   productos por fila, considerar un ícono/tooltip cuando algún item tenga `note` (para
   no alargar la fila), y el texto completo en el detalle.

### Errores

| Código | Cuándo |
|--------|--------|
| 400 | `note` > 150 caracteres en algún item de `review` |
| 404 `ORDER_ITEM_NOT_FOUND` | el `id` de algún item de `review` no pertenece a la orden |

---

## 2. Productos sin variantes (`stock`)

### Qué cambió

Antes, todo producto necesitaba al menos una variante (color/talle) para tener stock y
SKU. Ahora `POST /products` acepta un campo `stock` a nivel producto, usado **solo
cuando `variants` viene vacío**: el backend crea automáticamente una variante default
(`color: null, size: null`) con ese stock, para que el producto sea vendible por el
flujo normal de carrito/checkout sin que el front tenga que simular una variante.

| Caso | Comportamiento |
|------|-----------------|
| `variants: []` (o no se manda) y **sin** `stock` | `400 STOCK_REQUIRED` |
| `variants: []` y `stock: 20` | `201`; se crea 1 variante default con `stock: 20` |
| `variants: [...]` (una o más) | `stock` del body se **ignora**; cada variante trae su propio stock |

> Ruta: `POST /products` (Panel Admin, cookie, ADMIN/STAFF, **multipart/form-data**
> por la imagen). `PATCH /products/:id` no está incluido en este cambio.

### Ajustes en el front

1. **Form de alta de producto**: cuando la lista de variantes está vacía, mostrar un
   campo `stock` (entero, ≥0) y marcarlo **requerido** en ese estado. Sugerencia de UX:
   - Si el usuario no agregó ninguna variante → mostrar el input de `stock` a nivel
     producto (reemplazando o al lado del builder de variantes).
   - Apenas agrega una variante → ocultar/deshabilitar `stock` de producto (ya no se
     usa) y validar contra el stock de cada variante como hasta ahora.
2. **Envío multipart**: mandar `stock` como campo de texto (el backend lo castea con
   `z.coerce`), igual que `price`.
3. **Validación en cliente**: replicar la regla antes de enviar — si `variants.length
   === 0` y `stock` está vacío, bloquear el submit y mostrar el error en el campo
   (evita el viaje al 400).
4. **Render de producto**: un producto creado así tiene una única variante con
   `color: null, size: null` — en cards/listados donde hoy se muestra "color / talle",
   ocultar esa línea si ambos son `null` en vez de mostrar "null / null".

### Shape del error de validación (400)

```json
{
  "message": "El stock es requerido para un producto sin variantes",
  "code": "STOCK_REQUIRED"
}
```

### Errores

| Código | Cuándo |
|--------|--------|
| 400 `STOCK_REQUIRED` | `variants` vacío y `stock` no se mandó |

### Config por tenant: `productVariantsEnabled`

Nuevo campo en `TenantConfig` (`GET`/`PATCH /tenant-config/:tenantId`), booleano,
default `true`. Es **solo una señal para la UI**: el backend sigue aceptando
`variants: []` + `stock` o `variants: [...]` sin importar su valor, no hay
validación cruzada en el servidor.

- `false` → el panel admin de ese tenant no debería mostrar el builder de
  variantes al crear/editar productos; usar directamente el input de `stock` a
  nivel producto (ver punto anterior) como único flujo.
- `true` (default) → comportamiento actual sin cambios.
- Pensado para un onboarding tipo "¿qué tipo de negocio tenés?" (ej. pastelería
  vs. indumentaria): el backend no tiene ningún concepto de "rubro", el wizard
  es enteramente frontend y solo termina seteando este booleano vía `PATCH
  /tenant-config/:tenantId`.

```bash
# Desactivar el builder de variantes para un tenant (ej. Mesa Dulce)
curl -X PATCH --cookie "access_token=<jwt-admin>" \
  -H "Content-Type: application/json" \
  -d '{"productVariantsEnabled": false}' \
  http://localhost:4000/tenant-config/3
```

### `PATCH /products/:id` también soporta `stock` sin variantes

A diferencia de la versión anterior de esta guía, `PATCH /products/:id` ahora
acepta el mismo campo `stock` que la creación:

- Solo tiene efecto si el producto tiene **exactamente una** variante con
  `color: null, size: null` (la default creada sin variantes reales). En ese
  caso, actualiza el `stock` de esa variante.
- Si el producto tiene variantes reales (o más de una variante), `stock` del
  body se ignora silenciosamente — no da 400, es un no-op.

```bash
# Actualizar el stock de un producto sin variantes
curl -X PATCH --cookie "access_token=<jwt-admin>" \
  -H "Content-Type: application/json" \
  -d '{"stock": 30}' \
  http://localhost:4000/products/45
```

---

## 3. Checklist de verificación

- [ ] Revisar un pedido BOT con 2 líneas de la misma variante pero notas distintas →
      el form las muestra como 2 filas separadas, no las suma.
- [ ] Editar solo una de esas dos filas (por `id`) → la otra queda intacta (cantidad y
      nota sin cambios).
- [ ] `GET /orders/:id` como ADMIN sobre una orden BOT (`userId` null) → 200 con el
      detalle, no 404.
- [ ] Vaciar la `note` de una línea en la revisión (`note: null`) → se persiste como
      `null`; si no mandás la clave `note`, la existente no se toca.
- [ ] Cargar `note` > 150 caracteres → el form bloquea antes de enviar (y el 400 se
      maneja si igual llega al backend).
- [ ] Detalle de orden con items con y sin `note` → solo se muestra el texto cuando
      no es `null`.
- [ ] Crear producto sin variantes y sin `stock` → el form bloquea el submit (o el
      backend responde 400 `STOCK_REQUIRED` si se saltea la validación de cliente).
- [ ] Crear producto sin variantes con `stock: 15` → 201, y el producto es comprable
      desde el storefront con esa cantidad de stock.
- [ ] Crear producto con variantes → el campo `stock` de producto no se envía o se
      ignora sin afectar el stock de cada variante.
- [ ] Setear `productVariantsEnabled: false` en un tenant → el panel admin de ese
      tenant deja de mostrar el builder de variantes al crear/editar productos.
- [ ] `PATCH /products/:id` con `stock` sobre un producto sin variantes reales →
      actualiza el stock de la variante default; sobre un producto con variantes
      reales, el `stock` se ignora sin error.

---

## 4. Ejemplos curl

```bash
# Ver el detalle de un draft BOT como admin (antes 404, ahora 200)
curl --cookie "access_token=<jwt-admin>" http://localhost:4000/orders/57

# Revisar draft BOT: dos líneas de la misma variante, identificadas por id de fila
curl -X POST --cookie "access_token=<jwt-admin>" \
  -H "Content-Type: application/json" \
  -d '{"items":[{"id":231,"quantity":2,"note":"sin nueces"},{"id":232,"quantity":1,"note":null}]}' \
  http://localhost:4000/orders/57/review

# Crear producto sin variantes, con stock
curl -X POST --cookie "access_token=<jwt-admin>" \
  -F "name=Mesa Dulce x10" -F "price=15000" -F "categoryId=3" -F "stock=8" \
  http://localhost:4000/products

# Crear producto sin variantes y sin stock -> 400 STOCK_REQUIRED
curl -X POST --cookie "access_token=<jwt-admin>" \
  -F "name=Mesa Dulce x10" -F "price=15000" -F "categoryId=3" \
  http://localhost:4000/products
```

---

## 5. Resumen

- `OrderItem.note` (≤150 chars) es distinta de la nota de la orden (≤500). Se edita en
  `POST /orders/:id/review`; se lee en todas las respuestas de orden.
- Ya no hay unicidad `[orderId, variantId]`: el front no puede asumir una fila por
  producto. `productos[].id` (el `OrderItem.id`) es la clave para editar una línea en
  `review` — `variantId` ya no sirve para eso, solo para mostrar/agrupar info del
  producto.
- `GET /orders/:id` para ADMIN/STAFF ya no filtra por `userId`: trae cualquier orden
  del tenant, incluidas las BOT (antes era un bug y devolvía 404).
- `stock` en `POST /products` solo aplica sin variantes y es requerido en ese caso
  (`400 STOCK_REQUIRED` si falta); con variantes se ignora.
