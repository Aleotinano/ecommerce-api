---
lado: contrato
---

# Guía frontend: Chatbot de la tienda

Referencia de API para integrar el **asistente conversacional** del storefront: un bot que
responde, en lenguaje natural, sobre **catálogo, precios y stock** de la tienda. Hay **un bot por
tenant** y es **read-only** (no compra, no modifica nada). Funciona **anónimo** por defecto, y si
el cliente está logueado suma una capacidad extra (ver §4).

> Recordá las dos apps (ver [FRONTEND_INTEGRATION.md](FRONTEND_INTEGRATION.md)):
> - **Panel Admin** → rutas sin prefijo, auth por **cookie** httpOnly.
> - **Storefront** → rutas `/store/*`, header **`X-Tenant-Slug`** + **Bearer token opcional**.
>
> El chatbot es **storefront**. El front **no** maneja el tenant a mano: lo resuelve el backend por
> **slug** (subdominio o header `X-Tenant-Slug`).

---

## 1. Endpoint

| Método | Ruta | Auth | Notas |
|--------|------|------|-------|
| POST | `/store/chat/message` | `X-Tenant-Slug` + Bearer **opcional** | un mensaje del usuario + el historial; devuelve la respuesta del bot |

- El endpoint vive bajo `/store`, así que hereda la resolución de tenant por slug y el rate limit
  del chat. Si tu front usa un `storeFetcher` que ya prefija `/store`, la llamada es
  **`"/chat/message"`**.
- **Bearer opcional**: sin token el bot funciona igual (modo anónimo). Con un token válido **del
  mismo tenant**, el bot reconoce al cliente y habilita el extra de §4.

---

## 2. Request

Body (JSON):

```json
{
  "message": "¿Tenés remeras negras en talle M?",
  "history": [
    { "role": "user", "content": "hola" },
    { "role": "assistant", "content": "¡Hola! ¿En qué te ayudo?" }
  ]
}
```

| Campo | Tipo | Requerido | Límites (validados por el backend) |
|-------|------|-----------|-------------------------------------|
| `message` | string | **sí** | se hace `trim`; **mín 1**, **máx 1000** caracteres |
| `history` | `Message[]` | no (default `[]`) | **máx 20** mensajes |
| `history[].role` | `"user"` \| `"assistant"` | sí | solo esos dos valores (no `system`) |
| `history[].content` | string | sí | se hace `trim`; **mín 1**, **máx 2000** caracteres |

> **Stateless**: el backend **no guarda** la conversación. El `history` lo mantiene y envía el
> **cliente** en cada request. Es responsabilidad del front ir acumulando los turnos (ver §6).

---

## 3. Respuesta

`POST /store/chat/message` → **200**:

```json
{ "reply": "¡Sí! Tenemos la Remera básica en negro talle M, sale $4.500. ¿Querés que te pase más detalles?" }
```

| Campo | Tipo | Para qué sirve en la UI |
|-------|------|--------------------------|
| `reply` | string | el texto del asistente. Mostralo como una **burbuja del bot** en el chat. |

Cosas importantes del `reply`:

- **Siempre llega un `reply` con 200** cuando el request es válido y pasa los límites de uso —
  incluso si internamente el modelo falla o se queda sin pasos: en ese caso el backend devuelve un
  texto **amable de cierre** (p. ej. "no puedo procesar tu consulta ahora, probá de nuevo en un
  ratito"), no un error HTTP. Tratá ese texto como un mensaje más del bot.
- El bot **nunca** expone datos internos (códigos de producto/SKU, ids internos, nombres de
  herramientas). Solo habla en términos del cliente: nombre del producto, color, talle, precio.

---

## 4. Anónimo vs. logueado

| Situación | Qué puede hacer el bot |
|-----------|------------------------|
| **Anónimo** (sin Bearer) | Consultar catálogo, precios y disponibilidad de stock de la tienda. |
| **Logueado** (Bearer válido del tenant) | Todo lo anterior **+ consultar el estado de su propio pedido** (por número de pedido). |

- La consulta del estado del pedido **solo** está disponible para el cliente logueado, y siempre
  acotada a **sus** pedidos. Un usuario anónimo **nunca** puede acceder a esa información.
- En el front esto se traduce en: si tenés sesión de cliente, mandá el `Authorization: Bearer
  <token>` en el request del chat para habilitar ese extra. Si no, simplemente no lo mandes.

> No hace falta avisarle nada especial al backend: la diferencia la hace la **presencia del Bearer**.

---

## 5. Errores a manejar

⚠️ **La forma del cuerpo de error no es uniforme.** La validación de body (400) usa
`{ message, errors }`; el resto usa `{ error: { message, code } }`. Contemplá ambas.

| Código | `code` | Shape del body | Cuándo | UX sugerida |
|--------|--------|----------------|--------|-------------|
| 400 | — | `{ message, errors }` | body inválido: `message` vacío o > 1000, `history` > 20, `role`/`content` inválidos | Es bug del front (no debería pasar si validás localmente). No reintentar; corregir el payload. |
| 429 | `RATE_LIMIT_EXCEEDED` | `{ error: { message, code, retryAfter } }` + header `Retry-After` | demasiados mensajes desde la **misma IP** en poco tiempo (límite por IP) | "Estás yendo muy rápido, esperá unos segundos." Deshabilitar el envío y reintentar usando `retryAfter`. |
| 429 | `CHAT_DAILY_LIMIT` | `{ error: { message, code } }` | la **tienda** llegó a su tope diario de mensajes | "El asistente recibió muchas consultas hoy, probá de nuevo mañana." No reintentar hoy. |
| 503 | `CHAT_UNAVAILABLE` | `{ error: { message, code } }` | el asistente no está disponible temporalmente (degradación de servicio) | "El asistente no está disponible en este momento, probá en unos minutos." Reintentar más tarde con backoff. |
| 400 | `TENANT_REQUIRED` | `{ error: { message, code } }` | falta el slug del tenant (sin subdominio ni `X-Tenant-Slug`) | Bug de config del front: asegurate de mandar el tenant. |
| 404 | `TENANT_NOT_FOUND` | `{ error: { message, code } }` | el slug no corresponde a ninguna tienda | "Tienda no encontrada." |
| 403 | `TENANT_INACTIVE` | `{ error: { message, code } }` | la tienda está inactiva | "Tienda no disponible." |

> Nota: un fallo interno del modelo **no** es un error de la API: el backend responde **200** con un
> `reply` de cortesía (ver §3). No lo manejes como excepción.

Helper para leer el mensaje sin importar el shape:

```js
function readError(status, body) {
  if (body?.error) return { code: body.error.code, message: body.error.message };
  // 400 de validación: { message, errors }
  return { code: "VALIDATION", message: body?.message ?? "Solicitud inválida" };
}
```

---

## 6. Ejemplo de flujo multi-turno

El front arranca con `history: []` y, después de cada respuesta, **agrega** el mensaje del usuario y
el del bot al historial que mandará en el **próximo** request.

```js
// storeFetcher ya prefija /store y agrega X-Tenant-Slug (+ Bearer si hay sesión)
async function sendChat(message, history) {
  const res = await fetch("http://localhost:4000/store/chat/message", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tenant-Slug": "acme",
      // Authorization: `Bearer ${token}`,  // opcional: habilita estado de pedido (§4)
    },
    body: JSON.stringify({ message, history }),
  });

  const body = await res.json();
  if (!res.ok) {
    const { code, message } = readError(res.status, body);
    throw new Error(`${code}: ${message}`);
  }
  return body.reply;
}

// --- Turno 1 ---
let history = [];
const r1 = await sendChat("hola", history);
history = [
  ...history,
  { role: "user", content: "hola" },
  { role: "assistant", content: r1 },
];

// --- Turno 2 --- (el history ya lleva el turno 1)
const r2 = await sendChat("¿tenés remeras negras?", history);
history = [
  ...history,
  { role: "user", content: "¿tenés remeras negras?" },
  { role: "assistant", content: r2 },
];

// --- Turno 3 ---
const r3 = await sendChat("¿y en talle M cuánto sale?", history);
// ...y así sucesivamente. Recortá history a los últimos 20 antes de enviar (ver §7).
```

```bash
# curl: un turno con history (anónimo)
curl -X POST http://localhost:4000/store/chat/message \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Slug: acme" \
  -d '{
    "message": "¿y en talle M cuánto sale?",
    "history": [
      { "role": "user", "content": "¿tenés remeras negras?" },
      { "role": "assistant", "content": "Sí, tenemos la Remera básica en negro." }
    ]
  }'

# curl: logueado (habilita consultar el estado del propio pedido)
curl -X POST http://localhost:4000/store/chat/message \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Slug: acme" \
  -H "Authorization: Bearer <token>" \
  -d '{ "message": "¿cómo viene mi pedido 42?", "history": [] }'
```

---

## 7. Notas de UX / límites

- **El `history` crece**: tope **20 mensajes**. Antes de enviar, recortá a los **últimos 20**
  (`history.slice(-20)`). Cada `content` de history admite hasta **2000** caracteres y el `message`
  nuevo hasta **1000**: validá local antes de mandar para evitar 400.
- **Latencia variable**: por cada mensaje, el bot puede hacer **varias consultas internas** antes de
  responder. Mostrá un indicador "escribiendo…" y deshabilitá el input mientras esperás.
- **Se pierde al recargar**: en esta versión no hay persistencia; si el usuario refresca, la
  conversación arranca de cero. Si querés que sobreviva, guardá el `history` vos (p. ej.
  `sessionStorage`).
- **Sin streaming**: la respuesta llega **completa** en un solo 200 (ver §8).

---

## 8. Lo que el front NO debe hacer

- **No** implementar streaming/SSE: la respuesta es un único JSON con `reply` completo. No hay
  endpoint de stream.
- **No** mandar `tenantId` ni datos internos en el body: el tenant lo resuelve el backend por slug
  (`X-Tenant-Slug` / subdominio). El único body válido es `{ message, history }`.
- **No** esperar campos internos (SKU, ids internos, nombres de herramientas, etc.): el bot nunca
  los expone. La respuesta es solo `{ reply }`.
- **No** mandar roles distintos de `user` / `assistant` en `history` (un `system` u otro valor da
  400).

---

## 9. Notas / pendientes

- **Forma de error no uniforme**: el 400 de validación responde `{ message, errors }` mientras que
  el resto (`CHAT_UNAVAILABLE`, `CHAT_DAILY_LIMIT`, `RATE_LIMIT_EXCEEDED`, errores de tenant) usa
  `{ error: { message, code } }`. El front debe contemplar ambos (ver `readError` en §5).
- **Sin persistencia / sin `sessionId`**: hoy es 100% stateless; el historial lo lleva el cliente.
  El backend está preparado para sumar persistencia más adelante **sin cambiar este contrato**
  (`{ message, history } → { reply }`), así que el front no debería necesitar cambios cuando llegue.
- **Sin streaming**: si se quisiera respuesta token-a-token en el futuro, requeriría un endpoint
  nuevo; el actual no lo soporta.
- **Fallo del modelo = 200 con texto de cortesía**: no hay un `code` que distinga "el bot no pudo
  resolver" de "el bot respondió bien"; ambos llegan como `{ reply }` con 200. Si el producto
  necesita telemetría de esos casos, habría que exponerlo desde el backend.
- **Límite por IP vs. límite por tienda**: son dos cosas distintas (429 `RATE_LIMIT_EXCEEDED` por IP
  y 429 `CHAT_DAILY_LIMIT` por tenant). Conviene mostrar mensajes distintos según el `code`.
```
