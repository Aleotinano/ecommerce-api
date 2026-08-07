---
lado: contrato
---

# Checkout: entrega, pago y pedido por WhatsApp

> Última actualización: 2026-07-26.
> Cubre `POST /store/orders` (y su gemelo de backoffice `POST /orders`), que desde 2026-07-23 **ya
> no acepta un body vacío**. Si tu front todavía manda `POST /store/orders` sin nada, recibe un 400.

---

## 1. El flujo en tres pantallas

El cliente arma el carrito como siempre. Antes de confirmar hay que juntar tres cosas:

1. **Cómo paga** — efectivo, transferencia o mixto (con los montos de cada vía).
2. **Cómo lo recibe** — retiro en el local o envío a domicilio (con la ubicación).
3. **Confirmar** — el backend crea la orden y devuelve un link de WhatsApp con el pedido redactado;
   el front lo abre y el cliente manda el mensaje al negocio desde su propio WhatsApp.

El mensaje **no lo manda el servidor**. Sale del teléfono del cliente, así que el negocio recibe un
chat normal, con el cliente del otro lado, sin necesidad de plantillas aprobadas por Meta.

La orden ya quedó creada en `NEW` **antes** de que se mande el mensaje. Del otro lado, un admin
la revisa y recién ahí puede pasarla a producción. Si el cliente nunca manda el WhatsApp, la orden
igual existe.

---

## 2. `POST /store/orders`

**Headers:** `X-Tenant-Slug: <slug>` (o subdominio) + `Authorization: Bearer <token>`.
**Precondición:** el carrito no puede estar vacío (`400 EMPTY_CART`).

Los ítems, precios y total **no se mandan**: los resuelve el server desde el carrito. El body solo
describe entrega y pago.

```jsonc
{
  // --- Obligatorios ---
  "fulfillmentMethod": "DELIVERY",   // "DELIVERY" | "PICKUP"
  "paymentMethod": "MIXED",          // "CASH" | "TRANSFER" | "MIXED"

  // --- Ubicación: solo si DELIVERY. Hace falta addressText y/o addressMapsUrl ---
  "addressText": "Av. Siempre Viva 742",              // ≤ 300 chars
  "addressMapsUrl": "https://maps.app.goo.gl/xYz",    // ≤ 500, link de Google Maps
  "addressDetails": "rejas grises, timbre 2B",        // ≤ 300, opcional
  "addressLat": -34.6,                                // opcional, junto con Lng
  "addressLng": -58.4,

  // --- Montos: obligatorios si y solo si MIXED ---
  "cashAmount": 20000,
  "transferAmount": 22500,

  // --- Opcional, para cualquier método de pago ---
  "paymentNote": "transfiero el lunes a la mañana"    // ≤ 300
}
```

### Reglas que conviene replicar en el front

| Regla | Qué pasa si no se cumple |
|---|---|
| `DELIVERY` necesita `addressText` **y/o** `addressMapsUrl` | 400 (Zod) |
| `addressLat` y `addressLng` van juntos o no van | 400 (Zod) |
| `addressMapsUrl` tiene que ser de Google Maps (ver hosts abajo) | 400 (Zod) |
| `MIXED` exige `cashAmount` y `transferAmount`, ambos > 0 | 400 (Zod) |
| `CASH`/`TRANSFER` **no** aceptan esos montos | 400 (Zod) |
| `cashAmount + transferAmount` debe igualar el total del carrito | 400 `PAYMENT_AMOUNTS_MISMATCH` |
| El método de pago tiene que estar habilitado para **este tenant** | 400 `PAYMENT_METHOD_NOT_ENABLED` |
| La forma de entrega tiene que estar habilitada para **este tenant** | 400 `FULFILLMENT_METHOD_NOT_ENABLED` |

> [!important] No hardcodees los métodos (2026-07-29)
> Los tres pagos y las dos entregas son los valores *posibles* del sistema, no los que acepta cada
> tienda. Leé `paymentMethodsEnabled` y `fulfillmentMethodsEnabled` de `GET /store/config` y pintá
> solo esos — hay tenants que solo cobran contra entrega. Los dos errores nuevos traen
> `details: { pedido, habilitados }`, que sirve para el mensaje. Una lista vacía significa **todo
> habilitado**. Detalle completo en [FRONTEND_INTEGRATION.md](FRONTEND_INTEGRATION.md).
>
> Lo mismo con la seña: una orden creada por `/store/orders` ahora nace con `requiresDeposit` y
> `depositAmount` si el tenant cobra seña (antes salía siempre en `false`). Si aparece el blocker
> `DEPOSIT_NOT_CONFIRMED`, es eso.

**Hosts aceptados en `addressMapsUrl`:** `maps.app.goo.gl` (el que genera "Compartir ubicación" en
el teléfono), `maps.google.com`, `google.com/maps`, `www.google.com/maps`, `goo.gl/maps`.

> **El total lo manda el server.** Para armar la pantalla del pago mixto necesitás el total del
> carrito, y `GET /store/cart` **no devuelve un campo `total`**: sumalo vos línea por línea
> (`products[].price × products[].quantity` — `price` ya viene con la promo aplicada; `originalPrice`
> es el de lista). Ese es el número contra el que el server valida.
>
> Si entre medio cambió algo (stock, promo, precio), el server rechaza con
> `PAYMENT_AMOUNTS_MISMATCH` y **el carrito no se pierde** (la transacción hace rollback completo):
> el error trae `details: { total, suma }` — mostrale el total real y pedile que reparta de nuevo.

### Respuesta `201`

```jsonc
{
  "message": "Orden creada exitosamente",
  "order": {
    "id": 812,
    "user": "juana",
    "origin": "STORE",
    "status": "NEW",
    "paymentStatus": "PENDING",
    "fulfillmentMethod": "DELIVERY",
    "addressText": "Av. Siempre Viva 742",
    "addressLat": -34.6,
    "addressLng": -58.4,
    "addressDetails": "rejas grises, timbre 2B",
    "addressMapsUrl": "https://maps.app.goo.gl/xYz",
    "paymentMethod": "MIXED",
    "paymentNote": null,
    "cashAmount": 20000,
    "transferAmount": 22500,
    "total": 42500,
    "createdAt": "2026-07-26T13:05:00.000Z",
    "productos": [
      {
        "id": 1, "productId": 7, "variantId": 12,
        "nombre": "Torta chocolate",
        "cantidad": 2, "precio": 12000, "subtotal": 24000,
        "attributes": { "sabor": "chocolate" },
        "note": "sin nueces",
        "combo": null
      }
    ]
  },
  "whatsapp": {
    "url": "https://wa.me/5491155551234?text=Hola!%20Te%20dejo%20mi%20pedido%20%23812...",
    "message": "Hola! Te dejo mi pedido #812\n\n• 2x Torta chocolate — $24.000\n...",
    "phone": "5491155551234"
  }
}
```

### El bloque `whatsapp`

- `url` — deep-link listo para abrir. **Puede venir `null`**: pasa cuando el tenant no tiene
  `socialWhatsapp` ni `contactPhone` cargados en su config. La orden se creó igual — no trates
  `whatsapp: null` como un error, solo no muestres el botón (o mostrá el teléfono del local).
- `message` — el mismo texto sin encodear, por si querés previsualizarlo antes de abrir WhatsApp.
- `phone` — el número destino ya normalizado.

Cómo abrirlo (usá `_blank`; en móvil el SO intercepta el link y abre la app):

```js
const res = await fetch("/store/orders", { method: "POST", /* ... */ });
const data = await res.json();

if (res.ok) {
  vaciarCarritoLocal();               // el server ya lo vació
  irADetalleDeOrden(data.order.id);   // hacelo SIEMPRE, mande o no el WhatsApp
  if (data.whatsapp) window.open(data.whatsapp.url, "_blank");
}
```

> Navegá al detalle de la orden **además** de abrir WhatsApp, no en vez de. Si el cliente cierra
> WhatsApp sin mandar el mensaje, tiene que poder ver su pedido igual (y volver a abrir el link
> desde ahí, si querés guardarlo).

### Errores

| Código | HTTP | Cuándo |
|---|---|---|
| — (Zod) | 400 | body inválido; el detalle viene en `errors` por campo |
| `PAYMENT_AMOUNTS_MISMATCH` | 400 | los montos del mixto no suman el total (trae `details: { total, suma }`) |
| `EMPTY_CART` | 400 | el carrito está vacío |
| `PRODUCT_NOT_FOUND` / `PRODUCT_NOT_AVAILABLE` | 404 / 400 | un producto del carrito ya no existe o se desactivó |
| `VARIANT_NOT_FOUND` / `VARIANT_NOT_AVAILABLE` | 404 / 400 | ídem a nivel variante |
| `INSUFFICIENT_STOCK` | 409 | no alcanza el stock (trae `details` con la línea) |

Shape estándar: `{ "error": { "message", "code", "details"? } }`.

---

## 3. Revisión del pedido (panel admin)

Las órdenes que entran por `/store/orders` nacen con **`origin: "STORE"`** y **sin revisar**. No
pasan a `PROCESSING` ni `COMPLETED` hasta que un admin/staff las valide:

```
POST /orders/:id/review     → sella reviewedById/reviewedAt
```

**Desde 2026-07-29 no hace falta el `PATCH` después.** Si al revisar no queda nada pendiente, el
backend deja la orden en `PROCESSING` sola y la respuesta del review ya viene con
`status: "PROCESSING"` (ver [FRONTEND_ORDER_TRACKING.md](FRONTEND_ORDER_TRACKING.md) §1.1). El
`PATCH` manual sigue existiendo para `READY` y `COMPLETED`.

Sin ese review, cualquier intento de producir devuelve **409 `ORDER_NOT_REVIEWED`**. Aplica igual a
las órdenes del bot de WhatsApp (`origin: "BOT"`). Las que carga un admin desde el panel
(`POST /orders`) quedan `origin: "ADMIN"` y no necesitan revisión.

Otros guards que el panel tiene que poder resolver antes de producir — y que ahora podés leer sin
intentar la transición, en el campo `blockers` de cualquier respuesta de orden del panel:

| Código | Cómo se destraba |
|---|---|
| `ORDER_NOT_REVIEWED` | `POST /orders/:id/review` |
| `FULFILLMENT_INCOMPLETE` | completar entrega/pago vía `review` (típico en órdenes BOT) |
| `ADDRESS_MISSING` | cargar `addressText` o `addressMapsUrl` vía `review` |
| `TRANSFER_NOT_CONFIRMED` | `POST /orders/:id/confirm-transfer` (solo `TRANSFER`/`MIXED`, y solo si la orden **no** lleva seña) |
| `DEPOSIT_NOT_CONFIRMED` | `POST /orders/:id/confirm-deposit` (solo si la orden lleva seña) |

> **Con seña alcanza la seña** (2026-07-29). Antes, una orden con seña *y* pago por transferencia
> exigía las dos confirmaciones. Hoy no: se produce contra la seña y el saldo se cobra al entregar
> con `confirm-payment`. Los `blockers` de la orden son siempre la fuente de verdad de qué falta.

`POST /orders/:id/review` acepta los mismos campos de entrega/pago que el checkout (todos
opcionales, solo se pisan los que mandás) más `items: [{ id, quantity, note? }]` para corregir
cantidades. **Ojo con el mixto:** si corregís cantidades el total cambia y el desglose viejo deja de
cerrar — mandá `cashAmount`/`transferAmount` nuevos en el mismo request o vas a comer un
`PAYMENT_AMOUNTS_MISMATCH`. Si cambiás el método a `CASH`/`TRANSFER`, el desglose se limpia solo.

---

## 4. Lectura de órdenes

`GET /store/orders`, `GET /store/orders/:id`, `GET /orders/all` y las respuestas de `review`
devuelven los mismos campos de entrega y pago que el 201 de creación: `fulfillmentMethod`,
`addressText`, `addressLat`, `addressLng`, `addressDetails`, `addressMapsUrl`, `paymentMethod`,
`paymentNote`, `cashAmount`, `transferAmount`.

`GET /store/orders/:id` agrega `timeline` (ver
[FRONTEND_ORDER_TRACKING.md](FRONTEND_ORDER_TRACKING.md)) y `GET /orders/all` agrega `origin`,
`reviewedAt`, `transferConfirmedAt`, `requiresDeposit`, `depositAmount` y el bloque de estado del
motor (`blockers`, `canProduce`, `payment`). Ese bloque **solo va en las respuestas del panel**: el
storefront no lo recibe.

---

## 5. Checklist de migración

- [ ] `POST /store/orders` manda `fulfillmentMethod` y `paymentMethod` (antes iba sin body).
- [ ] Pantalla de pago con los tres métodos; si es mixto, dos inputs que sumen el total del carrito.
- [ ] Pantalla de ubicación solo si `DELIVERY`: dirección escrita y/o link de Maps, más un campo de
      referencias (`addressDetails`).
- [ ] Manejar `PAYMENT_AMOUNTS_MISMATCH` mostrando el total actualizado (viene en `details`).
- [ ] Abrir `whatsapp.url` tras el 201, tolerando `whatsapp: null`.
- [ ] Panel admin: botón "Revisar pedido" en las órdenes `NEW` con `origin` `STORE` o `BOT`, y
      mensajes claros para los 409 de la tabla de arriba (mejor: leer `blockers` y no llegar al 409).
- [ ] Panel admin: tras `review` o cualquier `confirm-*`, refrescar con el `status` que devuelve la
      respuesta — la orden puede haber pasado sola a `PROCESSING`.
