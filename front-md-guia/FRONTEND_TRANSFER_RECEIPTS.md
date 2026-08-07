---
lado: contrato
---

# Guía frontend: comprobantes de transferencia

Feature: adjuntarle a una orden **el comprobante de la transferencia** — la captura o el PDF del
banco que alguien miró para dar el cobro por bueno.

El problema que resuelve: hasta ahora el sistema guardaba *cuándo* y *quién* confirmó una
transferencia, pero no *qué miró*. El efectivo no se puede auditar; la transferencia sí.

> Es **exclusivo del Panel Admin** (rutas `/orders/...`, sin prefijo, cookie — ver
> [FRONTEND_INTEGRATION.md](FRONTEND_INTEGRATION.md)). El storefront no lo ve ni lo toca.
>
> **El cliente no sube su comprobante, y es una decisión tomada, no algo que falte.** Se lo manda al
> local por WhatsApp como siempre, y el admin lo adjunta desde el panel. Una pantalla de subida en el
> storefront no le ahorraría ese paso al cliente —lo manda igual— sino que le agregaría un canal más.
> No hay que diseñar nada del lado de la tienda para esto.

---

## 0. Las dos reglas que cambian cómo se diseña la pantalla

**1. Subir un comprobante NO confirma la transferencia.** Son dos acciones separadas y tienen que
verse separadas en la UI. El comprobante es evidencia; la confirmación la sigue haciendo una persona
que mira la cuenta bancaria (los comprobantes se falsifican en dos minutos). No pongas "subir" como
un paso de un wizard que termina confirmando solo.

**2. La URL del archivo es efímera: vence a los 10 minutos.** No la caches, no la guardes en estado
persistente ni en `localStorage`, no la metas en un `<a download>` que sobreviva a la sesión, no la
uses como `key` de React. Si la pantalla estuvo abierta un rato y el `<img>` ya no carga, **volvé a
pedir `GET /orders/:id/receipts`** para obtener una nueva.

El motivo: un comprobante lleva CBU, nombre y a veces el saldo de la cuenta. A diferencia de las
imágenes de producto, estos archivos no son públicos — el backend firma un link temporal cada vez.

---

## 1. Endpoints

Todos con cookie de admin. Rol: `ADMIN` o `STAFF`, **salvo el DELETE que es solo `ADMIN`**.

| Método | Ruta | Qué hace |
|---|---|---|
| `POST` | `/orders/:id/receipts` | Adjunta un comprobante. **No confirma nada** |
| `GET` | `/orders/:id/receipts` | Lista los comprobantes vivos, con URL firmada nueva |
| `DELETE` | `/orders/:id/receipts/:receiptId` | Borra el archivo y marca la fila → `204`. Solo `ADMIN` |
| `POST` | `/orders/:id/confirm-transfer` | Confirma. Acepta el comprobante **en el mismo request** |

### `POST /orders/:id/receipts`

`multipart/form-data`:

| Campo | Tipo | |
|---|---|---|
| `receipt` | File | **requerido**. JPG, PNG, WEBP, AVIF o **PDF**. Máx **10 MB** |
| `note` | string | opcional, ≤ 500 chars (ej. "transferencia del 12/03") |

```js
const form = new FormData();
form.append("receipt", file);
form.append("note", "Transferencia del 12/03");

const res = await fetch(`/orders/${orderId}/receipts`, {
  method: "POST",
  credentials: "include",
  body: form, // NO setees Content-Type a mano: el browser pone el boundary
});
```

`201`:

```jsonc
{
  "message": "Comprobante adjuntado exitosamente",
  "receipt": {
    "id": 12,
    "orderId": 812,
    "orderPaymentId": null,   // null = todavía no se usó para confirmar
    "mimeType": "application/pdf",
    "resourceType": "raw",
    "isPdf": true,            // ← con esto decidís <img> vs link
    "bytes": 84213,
    "originalName": "comprobante.pdf",
    "note": "Transferencia del 12/03",
    "uploadedById": 3,
    "createdAt": "2026-07-30T18:22:10.000Z",
    "url": "https://..."      // ⚠️ EFÍMERA, ver §0
  }
}
```

### `GET /orders/:id/receipts`

```jsonc
{ "receipts": [ /* mismo shape, cada uno con una `url` recién firmada */ ] }
```

Los borrados no aparecen. Si no hay ninguno, `receipts: []`.

### `POST /orders/:id/confirm-transfer` — ahora acepta el archivo

Sigue funcionando **exactamente igual** con JSON (no hay nada que migrar). Lo nuevo es que también
acepta `multipart/form-data`, para el caso normal: el admin ya decidió que la plata entró y confirma
y adjunta de una.

| Campo | Tipo | |
|---|---|---|
| `receipt` | File | opcional. Mismas reglas que arriba |
| `amount` | number | opcional, lo que realmente entró |
| `note` | string | opcional |
| `receiptIds` | number[] | opcional — comprobantes **ya subidos** que respaldan esta confirmación |

La respuesta es la de siempre más `receiptId` (el del archivo recién adjuntado, o `null`).

`receiptIds` es para el flujo "cargué la evidencia el lunes, confirmo el miércoles": mandá los ids de
los comprobantes que la persona está mirando y quedan enlazados al cobro. En multipart mandalo como
JSON string (`form.append("receiptIds", "[12,13]")`) — el backend lo castea.

---

## 2. Los tres estados que tenés que poder mostrar

Con `paymentMethod` en `TRANSFER` o `MIXED`:

| Estado | Cómo se detecta | Qué mostrar |
|---|---|---|
| Sin comprobante, sin confirmar | `receiptsCount === 0` y `transferConfirmedAt === null` | "Esperando la transferencia" |
| **Comprobante cargado, sin confirmar** | `receiptsCount > 0` y `transferConfirmedAt === null` | **"Hay N comprobantes para revisar"** — es la acción pendiente del admin |
| Confirmada | `transferConfirmedAt !== null` | "Cobrada", con el comprobante enlazado |

El estado del medio es el que antes no existía y es el que más importa: es la bandeja de trabajo del
admin.

De dónde salen los números:

- **En el listado** (`GET /orders/all`): campo **`receiptsCount`** en cada orden. Sirve para badgear
  filas sin pedir los archivos.
- **En el detalle** (`GET /orders/:id`, y en la respuesta de las confirmaciones): dentro de
  `blockers`, el que tiene `code: "TRANSFER_NOT_CONFIRMED"` trae
  `details: { esperado, cobrado, comprobantes }`.

```js
const blocker = order.blockers.find((b) => b.code === "TRANSFER_NOT_CONFIRMED");
if (blocker?.details.comprobantes > 0) {
  // "1 comprobante sin revisar" en vez de solo "falta confirmar la transferencia"
}
```

---

## 3. Renderizar el archivo

```jsx
{receipt.isPdf
  ? <a href={receipt.url} target="_blank" rel="noopener noreferrer">Ver comprobante (PDF)</a>
  : <img src={receipt.url} alt="Comprobante" />}
```

**Los PDF no tienen miniatura.** Se guardan tal cual los manda el banco (sin transformar), así que no
hay thumbnail que pedir — mostrá un link o un ícono de PDF con el `originalName`.

Aceptá PDF en el input, no lo bloquees:

```html
<input type="file" accept="image/jpeg,image/png,image/webp,image/avif,application/pdf" />
```

Es lo que exporta la mayoría de los home banking, y si lo rechazás la persona termina sacándole una
captura de pantalla al PDF (peor calidad y ~3× más pesada).

---

## 4. Borrar

Solo `ADMIN`; a un `STAFF` le va a volver `403`. Ocultá o deshabilitá el botón según el rol.

No es una corrección cosmética: **borra el archivo del proveedor de verdad** (es lo correcto — es el
CBU de una persona), y puede ser un archivo que ya se usó para confirmar un cobro. Pedí confirmación
explícita, y no ofrezcas "reemplazar": para corregir, se sube uno nuevo y, si hace falta, se borra el
viejo. Subir nunca pisa lo anterior — dos subidas son dos comprobantes.

---

## 5. Errores

| Código | HTTP | Cuándo |
|---|---|---|
| `INVALID_RECEIPT_TYPE` | 400 | Formato no permitido, **o** el contenido del archivo no coincide con lo que dice ser |
| `RECEIPT_TOO_LARGE` | 400 | Más de 10 MB |
| `RECEIPT_FILE_REQUIRED` | 400 | `POST /receipts` sin archivo |
| `ORDER_NOT_FOUND` | 404 | La orden no existe o es de otro tenant |
| `RECEIPT_NOT_FOUND` | 404 | El comprobante no existe, ya fue borrado, o no es de esa orden |
| `TRANSFER_ALREADY_CONFIRMED` | 409 | Ya se había confirmado. **El comprobante que hayas mandado en ese request no queda guardado** (se descarta con la operación) |
| `TRANSFER_NOT_APPLICABLE` | 409 | La orden es `CASH`: no hay transferencia que confirmar |

Todos con el shape de siempre: `{ "error": { "message", "code" } }`.

---

## 6. Nada se borra solo

**No hay ninguna purga automática.** Los comprobantes quedan hasta que un `ADMIN` los borre a mano
desde el panel. Es la decisión tomada, no un pendiente.

Dos consecuencias para la UI:

- **El borrado del panel es el único camino real**, así que el botón tiene que estar a mano y ser
  entendible — es más cómodo que entrar al dashboard de Cloudinary a buscar el archivo.
- Vale la pena decírselo al admin en algún lado (un texto de ayuda en la sección, no un modal): que
  los comprobantes se acumulan en la cuenta de almacenamiento de la tienda y que puede borrarlos
  cuando quiera desde ahí.

No asumas una ventana de retención ni muestres "vence en X días": no existe.

---

## 7. Qué archivo se espera que suban

Vale para escribir los textos de la pantalla. **Lo ideal no es la captura de pantalla del cliente**
—esas muestran poco más que un monto—, sino el **PDF que la tienda descarga de su propia cuenta de
cobro** (Mercado Pago, el banco): el comprobante del ingreso, visto del lado del que recibe la plata.

Si vas a poner un texto de ayuda en el uploader, que apunte a eso. Y dejá el campo `note` visible:
sirve para el caso mixto, tipo *"el cliente mandó captura, verificado en MP el 12/03"*.
