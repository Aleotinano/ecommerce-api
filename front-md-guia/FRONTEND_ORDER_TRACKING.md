---
lado: contrato
---

# Guía frontend: seguimiento y monitoreo de órdenes

Referencia de API para integrar lo nuevo del servicio de órdenes:

- **Cliente** → *seguimiento del pedido*: cada orden expone un **timeline** de estados (qué pasó y
  cuándo). Además el backend manda un **email automático** al cliente en cada cambio de estado.
- **Admin/Staff** → *monitoreo*: el listado de órdenes ahora soporta **filtro por estado**,
  **búsqueda por nombre** y **paginación**.

> Recordá las dos apps (ver [FRONTEND_INTEGRATION.md](FRONTEND_INTEGRATION.md)):
> - **Panel Admin** → rutas sin prefijo, auth por **cookie** httpOnly (`withCredentials`).
> - **Storefront** → rutas `/store/*`, auth por **Bearer token** + header `X-Tenant-Slug`.

---

## 1. Estados

`status` (`OrderStatus`):

| Valor | Significado |
|-------|-------------|
| `NEW` | Orden creada, sin procesar (estado inicial). |
| `PROCESSING` | En preparación. |
| `READY` | **(nuevo, 2026-07-29)** Listo para retirar/enviar. Paso **opcional**: si no lo usás, `PROCESSING → COMPLETED` sigue funcionando igual. |
| `COMPLETED` | Completada (al pasar a este estado se **descuenta stock**). |
| `CANCELLED` | Cancelada. |

`paymentStatus` (`PaymentStatus`): `PENDING`, `APPROVED`, `REJECTED`, `IN_PROCESS`, `REFUNDED`,
`DEPOSIT_PAID`, `PAID_IN_FULL`. Es un eje aparte de `status`.

**Reglas de transición** (las aplica el backend, el front solo ofrece las válidas):

- Una orden en `COMPLETED` o `CANCELLED` **no se puede modificar** (devuelve 409).
- Una orden solo **avanza**: `NEW → PROCESSING → READY → COMPLETED`, salteando pasos si querés.
  Cualquier destino anterior (volver a `NEW`, o de `READY` a `PROCESSING`) devuelve 400
  `INVALID_STATUS_TRANSITION`.
- Desde cualquier estado no terminal se puede pasar a `CANCELLED`.
- Pasar a `COMPLETED` valida y descuenta stock; si falta stock devuelve 409 `INSUFFICIENT_STOCK`.

### 1.1 La orden puede avanzar sola

Desde 2026-07-29 el backend mueve `NEW → PROCESSING` **automáticamente** cuando la orden queda
sin nada pendiente (se la revisó, tiene entrega y pago completos, y el cobro que hacía falta está
confirmado). Pasa al revisar (`POST /orders/:id/review`) y al confirmar un cobro
(`confirm-deposit`, `confirm-transfer`, `confirm-payment`).

**Qué implica para el front:** la respuesta de esas acciones puede venir con `status: "PROCESSING"`
aunque vos no lo hayas pedido. Pintá el `status` que trae la respuesta, no asumas que sigue en
`NEW`.

Lo que **no** se automatiza: crear una orden (nace `NEW` aunque esté completa), `READY` y
`COMPLETED` — esos los sigue apretando una persona.

### 1.2 `blockers` — qué le falta a la orden

Las respuestas de órdenes del **panel** (no las del storefront) traen tres campos nuevos:

```json
{
  "canProduce": false,
  "blockers": [
    { "code": "ADDRESS_MISSING", "message": "Falta la dirección de entrega" }
  ],
  "payment": { "total": 10000, "paid": 5000, "pending": 5000, "settled": false,
               "expected":  { "CASH": 10000, "TRANSFER": 0 },
               "byChannel": { "CASH": 5000, "TRANSFER": 0, "GATEWAY": 0 } }
}
```

Con esto el botón de "pasar a preparación" se puede deshabilitar **con el motivo a la vista**, en vez
de dejar que la persona apriete y se coma un 409. Los `code` son los mismos que ya devolvía el error:
`ORDER_NOT_REVIEWED`, `DEPOSIT_NOT_CONFIRMED`, `FULFILLMENT_INCOMPLETE`, `ADDRESS_MISSING`,
`TRANSFER_NOT_CONFIRMED`. `blockers: []` + `canProduce: true` = no le falta nada.

`payment.paid` es la **suma real de lo cobrado** (ver §1.3), no una estimación.

### 1.3 Libro de cobros (2026-07-29)

Cada cobro de una orden es una fila con vía y monto. Con eso se puede mostrar "cobrado $5.000 de
$12.000, falta $7.000 en efectivo" en vez de un booleano.

| Método | Ruta | Body |
|--------|------|------|
| GET | `/orders/:id/payments` | — |
| POST | `/orders/:id/payments` | `{ kind, channel, amount, note? }` |

- `kind`: `DEPOSIT` (seña) \| `PAYMENT` (cobro) \| `REFUND` (devolución).
- `channel`: `CASH` \| `TRANSFER`. `GATEWAY` (MercadoPago) lo escribe el webhook — por HTTP da 400.
- `amount`: **siempre positivo**, también en una devolución; el signo lo pone `kind`.

`GET` devuelve `{ payments, payment, pending }` — el libro, el resumen, y cuánto falta por cada vía
(`pending`), que es el número que conviene proponer al cobrar.

Usá `POST /payments` para lo que no encaja en los botones de siempre: un pago parcial a cuenta, una
devolución, un cobro por una vía distinta a la pactada. Para el flujo normal seguí usando los tres
`confirm-*`, que ahora escriben en este mismo libro.

**Dos cambios en los `confirm-*`:**

- `confirm-deposit` y `confirm-payment` aceptan `channel` (`CASH`/`TRANSFER`), y lo **exigen** cuando
  el backend no puede deducirlo: orden `MIXED`, o sin `paymentMethod` definido (el estado normal de
  un pedido del bot sin revisar). Sin él responden **400 `PAYMENT_CHANNEL_REQUIRED`**. Es el único
  cambio incompatible de esta tanda: si tu panel llama a `confirm-payment` sobre pedidos del bot,
  agregale el campo.
- `confirm-transfer` acepta `amount`: cuánto entró realmente. Sin él se asume lo que la orden todavía
  debe por transferencia. Mandalo si el cliente transfirió una parte — la orden queda con el saldo
  pendiente y no pasa a producción hasta que entre el resto.
- La respuesta de `confirm-transfer` ahora trae `paymentStatus` (antes no, porque no lo movía).

---

## 2. Cliente — seguimiento del pedido (`/store/*`, Bearer + `X-Tenant-Slug`)

| Método | Ruta | Query | Notas |
|--------|------|-------|-------|
| GET | `/store/orders` | `status`, `limit`, `offset` | órdenes del customer (listado, **sin** timeline) |
| GET | `/store/orders/:id` | — | detalle del pedido **con `timeline`** |

`GET /store/orders/:id` → el `order` incluye `timeline` (cronológico ascendente):

```json
{
  "order": {
    "id": 42,
    "status": "COMPLETED",
    "paymentStatus": "APPROVED",
    "total": 9000,
    "createdAt": "2026-06-06T10:30:00.000Z",
    "updatedAt": "2026-06-06T12:00:00.000Z",
    "productos": [
      {
        "nombre": "Remera básica",
        "description": "Algodón premium",
        "cantidad": 1,
        "precioUnitario": 4500,
        "subtotal": 4500,
        "color": "negro",
        "size": "M",
        "image": "https://..."
      }
    ],
    "timeline": [
      { "estado": "NEW",    "nota": "Pedido creado",         "fecha": "2026-06-06T10:30:00.000Z", "automatico": false },
      { "estado": "PROCESSING", "nota": "Pedido en preparación", "fecha": "2026-06-06T11:30:00.000Z", "automatico": true  },
      { "estado": "COMPLETED",  "nota": "Pedido completado",     "fecha": "2026-06-06T12:00:00.000Z", "automatico": false }
    ]
  }
}
```

- `timeline[].estado` es el estado al que pasó la orden; `nota` puede ser `null`; `fecha` es ISO.
- `timeline[].automatico` (2026-07-29) distingue el avance que hizo el backend al cumplirse las
  condiciones del que apretó una persona. Sirve para mostrarlo distinto ("automático") en el detalle.
- El **listado** (`GET /store/orders`) **no** trae `timeline` — pedí el detalle para mostrarlo.
- **Email:** el cliente recibe un mail automático en cada cambio de estado. El front **no** dispara
  nada; es 100% backend.

---

## 3. Admin — monitoreo (rutas sin prefijo, cookie)

| Método | Ruta | Query / Body | Notas |
|--------|------|--------------|-------|
| GET | `/orders/all` | query: `status`, `search`, `limit`, `offset` | todas las órdenes del tenant (ADMIN/STAFF) |
| GET | `/orders/:id` | — | detalle con `timeline` (mismo shape que storefront) |
| PATCH | `/orders/:id` | body: `{ status, note? }` | cambia el estado (ADMIN/STAFF) |

### `GET /orders/all` — filtros, búsqueda y paginación

Query params (todos opcionales):

| Param | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `status` | enum | — | filtra por un estado: `NEW` \| `PROCESSING` \| `READY` \| `COMPLETED` \| `CANCELLED`. **Chip de filtro** → seteá este param. "Todos" = omitirlo. |
| `search` | string | — | nombre de **cliente (username)** o de **producto**. Case-insensitive, substring. |
| `limit` | int | `10` | máx `100`. |
| `offset` | int | `0` | desplazamiento para paginar. |

Respuesta `{ orders: [...] }` (cada item incluye `usuario`, **sin** `timeline`):

```json
{
  "orders": [
    {
      "id": 42,
      "usuario": { "id": 5, "username": "customer_acme" },
      "status": "PROCESSING",
      "paymentStatus": "IN_PROCESS",
      "total": 9000,
      "createdAt": "2026-06-06T10:30:00.000Z",
      "productos": [
        { "nombre": "Remera básica", "cantidad": 1, "precio": 4500, "color": "negro", "size": "M" }
      ]
    }
  ]
}
```

### `PATCH /orders/:id` — cambiar estado

Body:

```json
{ "status": "PROCESSING", "note": "En depósito, se despacha hoy" }
```

- `status`: requerido, uno del enum (incluye `PROCESSING` y `READY`).
- `note`: opcional, máx **500** caracteres. Queda registrada en el `timeline` de la orden.
- Si la orden ya está en el estado pedido, responde 200 sin registrar nada (es un doble click, no un
  error). Ojo con esto: puede pasar si la orden avanzó sola justo antes.

Respuesta:

```json
{
  "message": "Orden en preparación exitosamente",
  "order": {
    "id": 42,
    "status": "PROCESSING",
    "paymentStatus": "IN_PROCESS",
    "total": 9000,
    "updatedAt": "2026-06-06T11:30:00.000Z"
  }
}
```

> El cambio de estado también dispara el email automático al cliente (backend).

---

## 4. Paginación (convención del repo)

Igual que el listado de productos: la respuesta es una **lista, sin `total`/`totalPages`**. El front:

- infiere **"hay más páginas"** cuando `orders.length === limit`;
- avanza con `offset += limit` (y retrocede restando).

Los **chips de estado** solo cambian `?status=`; el chip "Todos" omite el param. La **búsqueda** setea
`?search=` (conviene debounce). Al cambiar filtro o búsqueda, reseteá `offset` a `0`.

---

## 5. Errores a manejar

| Código | Cuándo |
|--------|--------|
| 400 | validación de query/body (`status` inválido, `note` > 500, `limit` > 100, etc.) |
| 401 | sin auth (cookie ausente/ inválida en admin; Bearer ausente en storefront) |
| 403 | rol insuficiente en `/orders/all` y `PATCH /orders/:id` (requiere ADMIN/STAFF); o token de otro tenant |
| 404 `ORDER_NOT_FOUND` | la orden no existe / no es del usuario o tenant |
| 409 `ORDER_ALREADY_COMPLETED` | se intentó modificar una orden ya completada |
| 409 `ORDER_ALREADY_CANCELLED` | se intentó modificar una orden ya cancelada |
| 409 `INSUFFICIENT_STOCK` | falta stock al pasar a `COMPLETED` (incluye `details`) |
| 400 `INVALID_STATUS_TRANSITION` | transición de estado no permitida |

---

## 6. Ejemplos curl

```bash
# Cliente: detalle del pedido con timeline (storefront)
curl -H "X-Tenant-Slug: acme" -H "Authorization: Bearer <token>" \
  http://localhost:4000/store/orders/42

# Cliente: solo pedidos completados, paginado
curl -H "X-Tenant-Slug: acme" -H "Authorization: Bearer <token>" \
  "http://localhost:4000/store/orders?status=COMPLETED&limit=10&offset=0"

# Admin: monitoreo filtrado + búsqueda + paginación (cookie)
curl --cookie "access_token=<jwt-admin>" \
  "http://localhost:4000/orders/all?status=PROCESSING&search=customer&limit=5&offset=0"

# Admin: cambiar estado con nota (queda en el timeline)
curl -X PATCH --cookie "access_token=<jwt-admin>" \
  -H "Content-Type: application/json" \
  -d '{"status":"PROCESSING","note":"En depósito, se despacha hoy"}' \
  http://localhost:4000/orders/42
```
