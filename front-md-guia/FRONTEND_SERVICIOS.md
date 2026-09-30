---
lado: contrato
---

# Guía frontend: Servicios (turnos)

Feature: **servicios** — un tercer tipo de producto (`type: "SERVICIO"`) para los negocios que además
de vender productos prestan servicios: peluquería canina, peluquería, catering. Un servicio vive en el
catálogo **como un producto más** (categorías, listado, carrito, pedido); lo que cambia es que:

1. **no tiene stock** (siempre está disponible),
2. **cada línea lleva un turno**: día, hora y — según el servicio — para quién es,
3. el servicio define **si pide destinatario** (el nombre del perro, del hijo, de la empresa).

No hay rutas nuevas. Todo el cambio es **aditivo**: productos, combos y pedidos existentes no cambian.

> Recordá las dos apps (ver [FRONTEND_INTEGRATION.md](FRONTEND_INTEGRATION.md)): el alta del servicio
> es **Panel Admin**; pedir el turno pasa en **ambas apps** (carrito del Storefront y mostrador del
> Panel). Reglas de negocio completas: `docs/servicios/dominio/Servicios.md`.

---

## 1. Modelo: el servicio en `Product`

| Campo | Tipo | Notas |
|---|---|---|
| `type` | `"SERVICIO"` | los otros son `"PRODUCTO"` y `"COMBO"` |
| `variants[]` | como PRODUCTO | el precio vive en la variante, igual que un producto: "Baño perro chico $12.000 / grande $18.000" son dos variantes |
| `variants[].stock` | `0` | **no significa nada** — un servicio no tiene stock. No lo muestres ni lo uses para ocultar el servicio |
| `serviceRecipient` | `"DIRECTO" \| "TERCERO" \| "AMBOS"` | para quién es el servicio (ver tabla) |
| `serviceRecipientLabel` | string \| null | cómo preguntarle al cliente por el destinatario ("Nombre del perro"). `null` = texto default del front |

`serviceRecipient` y `serviceRecipientLabel` son `null` en productos y combos.

| `serviceRecipient` | Qué significa | Campo "para quién" en el form del turno | Ejemplo |
|---|---|---|---|
| `DIRECTO` | lo recibe quien lo contrata | **no se muestra** (mandarlo da 400) | masaje, corte para uno mismo |
| `TERCERO` | siempre es para otro | **obligatorio** | peluquería canina (el perro), catering (la empresa) |
| `AMBOS` | el cliente elige | opcional ("¿Es para otra persona?"); vacío = para quien contrata | peluquería: para sí o para su hijo |

## 2. Panel Admin: alta y edición

```json
// POST /products — alta en 1 paso: `price` solo (SIN stock)
{
  "name": "Corte de pelo",
  "type": "SERVICIO",
  "price": 8000,
  "categoryId": 4,
  "serviceRecipient": "AMBOS"
}

// POST /products — precio por variante (sin stock en las variantes)
{
  "name": "Baño y corte",
  "type": "SERVICIO",
  "serviceRecipient": "TERCERO",
  "serviceRecipientLabel": "Nombre del perro",
  "variants": [
    { "attributes": { "tamaño": "chico" }, "price": 12000 },
    { "attributes": { "tamaño": "grande" }, "price": 18000 }
  ]
}
```

Como el alta es `multipart/form-data`, los campos viajan como texto igual que `price` (`-F
"serviceRecipient=TERCERO"`).

- Sin `serviceRecipient` el servicio queda `DIRECTO`.
- `stock` en un servicio → `400` (validación, `path: ["stock"]`).
- `serviceRecipient`/`serviceRecipientLabel` en un producto o combo → `400` (en el alta, validación;
  en un `PATCH` sin `type`, `SERVICE_FIELDS_NOT_ALLOWED`).
- `POST /variants/:productId` sobre un servicio: `stock` no hace falta. Sobre un PRODUCTO sigue
  siendo obligatorio → ahora sale como `400 STOCK_REQUIRED` (antes era un error de validación de Zod).
- `PATCH /products/:id` con `type: "SERVICIO"` sobre un PRODUCTO **conserva sus variantes** (las dos
  formas se pricean igual); si no mandás `serviceRecipient`, queda `DIRECTO`. Volver a PRODUCTO limpia
  los campos de servicio, y el stock de las variantes queda en lo que tuvieran (un servicio nacido
  como tal tiene 0: avisale al admin que lo cargue).
- Un servicio **no puede ser parte de un combo** → `400 COMBO_SERVICE_NOT_ALLOWED`. El picker de la
  whitelist de combos no debería ofrecerlos.
- Tampoco entra en promos por cantidad (`PROMO_PRODUCT_TYPE_NOT_ALLOWED`).

**Sugerencia de UX**: en el selector de tipo agregar "Servicio". Al elegirlo: ocultar stock, mostrar
"¿Para quién es?" (tres opciones de la tabla) y, si no es `DIRECTO`, el input de la etiqueta con
placeholder "Ej: Nombre del perro".

## 3. Storefront: la sección de servicios

- **Listado**: `GET /store/products?type=SERVICIO` trae solo servicios — es la "sección de
  servicios". Sin el filtro, aparecen mezclados con los productos (misma categoría, mismo listado).
- **Disponibilidad**: un servicio está **siempre disponible**. Si el storefront oculta productos sin
  stock (`showOutOfStock: false`), **excluí los servicios de esa regla** — sus variantes tienen
  `stock: 0` y quedarían ocultos. El backend no filtra por stock.
- **Ficha**: en vez de "Agregar al carrito" directo, un form de turno:
  - selector de variante (si hay más de una),
  - **día** (date picker, desde hoy),
  - **hora** (`HH:MM`, 24 h),
  - **para quién** según `serviceRecipient` (tabla de la sección 1), con `serviceRecipientLabel` como
    label.
- No hay agenda ni control de horarios ocupados en v1: el local confirma o reprograma el turno al
  revisar el pedido. Vale un texto tipo "Te confirmamos el turno por WhatsApp".

## 4. Carrito

```json
// POST /store/cart/:productId (y POST /cart/:productId en el Panel)
{
  "variantId": 108,
  "service": { "date": "2026-10-05", "time": "10:30", "recipientName": "Firulais" }
}
```

| Campo de `service` | Formato | Notas |
|---|---|---|
| `date` | `"YYYY-MM-DD"` | tiene que existir (`2026-02-30` no pasa) y no puede ser anterior a hoy |
| `time` | `"HH:MM"` 24 h | `"09:30"`, no `"9:30"` |
| `recipientName` | string ≤ 100 \| null | según `serviceRecipient` |

- **Una línea por servicio + variante, siempre cantidad 1.** Volver a hacer `POST` sobre el mismo
  servicio y variante **reemplaza el turno** (no suma). Consecuencia en v1: dos turnos del mismo
  servicio y variante (dos perros chicos) no entran juntos en el carrito — el segundo pisa al primero.
  Si lo necesitan, que lo carguen desde el mostrador (el pedido sí admite dos líneas) o avisen en la
  nota.
- `PATCH /store/cart/:productId` (restar 1) funciona igual que siempre: en una línea de servicio la
  borra.
- `GET /store/cart`: cada línea trae `service` (`null` en productos y combos) y `stock: null` en
  servicios:

```json
{
  "product": { "id": 31, "name": "Baño y corte", "type": "SERVICIO", "img": "https://..." },
  "variant": { "id": 108, "attributes": { "tamaño": "grande" }, "sku": "..." },
  "price": 18000,
  "stock": null,
  "quantity": 1,
  "comboSelection": null,
  "service": { "date": "2026-10-05", "time": "10:30", "recipientName": "Firulais" }
}
```

Mostralo en el carrito como "Sáb 05/10 · 10:30 · Firulais". **Formateá la fecha como fecha pura**:
`new Date("2026-10-05")` es medianoche UTC y en Argentina se ve como el día anterior. Partí el string
o usá una librería de fechas sin zona.

## 5. Pedido

- **Checkout** (`POST /store/orders`): no cambia el body — el turno sale del carrito.
- **Mostrador** (`POST /orders` con `items`): cada línea de servicio lleva su `service`:

```json
{
  "fulfillmentMethod": "PICKUP",
  "paymentMethod": "CASH",
  "items": [
    { "productId": 31, "variantId": 108, "quantity": 1,
      "service": { "date": "2026-10-05", "time": "10:30", "recipientName": "Firulais" } },
    { "productId": 31, "variantId": 108, "quantity": 1,
      "service": { "date": "2026-10-05", "time": "11:30", "recipientName": "Luna" } }
  ]
}
```

  En el mostrador **no** se rechaza una fecha pasada (se puede registrar un turno que ya se hizo), y
  sí entran dos líneas del mismo servicio.
- **Respuestas de orden** (`POST /orders`, `POST /store/orders`, `GET /orders`, `GET /orders/all`,
  `GET /orders/:id`, `GET /store/orders/:id`, seguimiento de invitado, `POST /orders/:id/review`):
  cada línea de `productos[]` trae `service` (`null` si no es servicio).
- **Reprogramar** (`POST /orders/:id/review`): cada ítem acepta `service`, que **reemplaza el turno
  completo**. Si no lo mandás, se conserva.

```json
{ "items": [ { "id": 501, "quantity": 1,
  "service": { "date": "2026-10-06", "time": "15:30", "recipientName": "Firulais" } } ] }
```

- Completar un pedido con servicios no descuenta stock de nada.
- `GET /orders/export`: la hoja "Ítems" suma la columna **Turno**.

## 6. Errores

| Código | Status | Cuándo |
|---|---|---|
| `SERVICE_BOOKING_REQUIRED` | 400 | servicio sin `service` (carrito o mostrador) |
| `SERVICE_BOOKING_NOT_ALLOWED` | 400 | mandaste `service` para algo que no es servicio |
| `SERVICE_RECIPIENT_REQUIRED` | 400 | servicio `TERCERO` sin `recipientName` (el mensaje usa `serviceRecipientLabel`) |
| `SERVICE_RECIPIENT_NOT_ALLOWED` | 400 | servicio `DIRECTO` con `recipientName` |
| `SERVICE_DATE_IN_PAST` | 400 | fecha anterior a hoy (solo carrito) |
| `SERVICE_FIELDS_NOT_ALLOWED` | 400 | `serviceRecipient`/`serviceRecipientLabel` en un producto o combo |
| `COMBO_SERVICE_NOT_ALLOWED` | 400 | un servicio en la whitelist o la selección de un combo |
| `STOCK_REQUIRED` | 400 | variante nueva de un PRODUCTO sin `stock` |
| validación (Zod) | 400 | `date` que no es `YYYY-MM-DD` o no existe, `time` que no es `HH:MM` |

## 7. Checklist de verificación

- [ ] Crear un servicio con `price` solo → `201`, una variante con `stock: 0`, `serviceRecipient: "DIRECTO"`.
- [ ] Crear un servicio con `stock` → `400`.
- [ ] `GET /store/products?type=SERVICIO` → solo servicios; se muestran aunque `showOutOfStock` sea `false`.
- [ ] Agregar un servicio al carrito sin `service` → `400 SERVICE_BOOKING_REQUIRED`.
- [ ] Servicio `TERCERO` sin nombre → `400 SERVICE_RECIPIENT_REQUIRED` con el label del servicio en el mensaje.
- [ ] Servicio `DIRECTO` con nombre → `400 SERVICE_RECIPIENT_NOT_ALLOWED` (el form no debería mostrar el campo).
- [ ] Fecha de ayer → `400 SERVICE_DATE_IN_PAST`.
- [ ] Volver a agregar el mismo servicio con otra hora → la línea sigue en cantidad 1, con la hora nueva.
- [ ] Checkout → cada línea de servicio del pedido trae `service`; las de productos, `service: null`.
- [ ] La fecha se ve igual en el carrito, el pedido y el panel (sin correrse un día).
- [ ] Revisar un pedido mandando `service` en un ítem → turno reprogramado; los demás ítems conservan el suyo.
- [ ] Completar un pedido con servicios → `200`, sin error de stock.
