---
tags: [servicio, dominio/chat]
estado: en-desarrollo
ultima-revision: 2026-06-24
---

# Chat de tienda

Asistente conversacional del storefront para clientes finales: responde sobre catálogo, precios y
stock **usando tools** (nunca inventa datos) y puede registrar pedidos borrador. Es **read-only de
punta a punta** salvo una única tool de escritura (`createDraftOrder`).

> [!important] Es el **motor compartido**, no solo el chat web
> `ChatModel` (`services/chat/index.js`) es el cerebro del bot. Lo consumen **dos canales**:
> - el endpoint web `POST /store/chat/message` ([[App|storefront]]), y
> - [[WhatsApp]] (`WhatsappModel.processInbound` llama a `ChatModel.sendMessage`).
>
> WhatsApp **no reescribe** el bot ni las tools: entra como un visitante anónimo más. Toda regla
> documentada acá (cost-guard, tools, seguridad de tenant) la hereda WhatsApp.

## Propósito

Dar una capa conversacional sobre el catálogo del tenant: búsqueda, detalle, disponibilidad,
categorías, estado de pedidos (si hay login) y alta de pedido borrador (si el canal da identidad de
cliente). El asistente habla en español rioplatense con la marca del tenant inyectada desde
[[TenantConfig]] (`storeName`, `storeTagline`, `storeDescription`, `currency`).

## Modelo de datos

**No tiene modelo propio.** El chat es **stateless**: el `history` llega del cliente y **no se
persiste** (ver `services/chat/index.js`, hay un `TODO(persistencia)` que dejaría guardar el turno
sin cambiar el contrato). El único estado conversacional persistido existe del lado de [[WhatsApp]]
(history corto en Redis, porque ese canal no reenvía el historial en cada webhook).

Contrato de la fachada:

```
ChatModel.sendMessage({ tenantId, user, message, history, channel, now }) -> { reply }
```

- `tenantId` — resuelto por slug (`req.tenantId`) o por `phone_number_id` (WhatsApp). **NUNCA del LLM.**
- `user` — cliente logueado (`req.user`) o `null` (anónimo). Habilita/oculta `getMyOrderStatus`.
- `channel` — `null` (web) o `{ kind:"whatsapp", waId, contactName }`. Habilita `createDraftOrder`.

## Reglas de negocio / invariantes

> [!warning] Invariante de seguridad: **fail-closed** en el cost-guard
> `consumeChatQuota` (`services/chat/cost-guard.js`) degrada **CERRADO**: si Redis no está o falla,
> lanza **503** y **no** llama al LLM. Es un endpoint anónimo/público: no exponemos la API key a
> abuso si Redis se cae. Es la **excepción** al "degradar-abierto" general de [[Redis y cache]];
> contrastar con el cost-guard de [[Sugerencias de contenido]] (admin, degrada abierto) y con el
> rate-limit propio de [[WhatsApp]] (`consumeWaQuota`, degrada abierto).

- **El scope de tenant se inyecta server-side.** Ninguna tool declara `tenantId`/`user`: los handlers
  los toman del closure (`buildToolContext`). El LLM solo elige filtros de dominio (`query`,
  `productId`, `color`, `size`). Un prompt no puede saltar de tenant. (Refuerza el scoping manual de
  [[Multi-tenancy]].)
- **Vistas limitadas.** Cada tool devuelve una vista recortada, nunca el objeto Prisma crudo: jamás
  se exponen `sku`, `imgPublicId`, ids internos ni estructura de DB. El system prompt además prohíbe
  revelar nombres de tools/funciones o detalles técnicos (CONFIDENCIALIDAD "no negociable").
- **Respeta `TenantConfig.showOutOfStock`.** Si es `false` (default), oculta productos y variantes sin
  stock en todas las tools de lectura.
- **`createDraftOrder` es la única escritura, y no decide nada monetario.** El LLM solo propone
  `productId` + `quantity` (+ color/size). El server resuelve la variante, valida catálogo, calcula
  precio/total/seña y el tenant. La orden nace con origen **BOT, sin revisar**, para que un humano la
  valide; el bot **no** toca `paymentStatus` ni montos (ver [[Órdenes]] → `createDraft`). El system
  prompt instruye explícitamente a no prometer precios finales ni montos de seña.
- **`getMyOrderStatus` exige login.** Se filtra de la lista para anónimos y, en defensa en profundidad,
  el handler no ejecuta sin `user`. Scope por `user.id` **y** `tenantId`.
- **History no confiable.** El `history` es input del cliente: lo valida zod en el endpoint
  (`chatMessageBody`) y lo **vuelve a sanear** el loop (`sanitizeHistory`: solo roles `user`/
  `assistant`, content string no vacío, últimos 20).

### Disponibilidad de tools (matriz)

| Tool | Web anónimo | Web logueado | WhatsApp (anónimo + canal) |
|---|:---:|:---:|:---:|
| `searchProducts`, `getProductDetail`, `checkAvailability`, `listCategories` | ✅ | ✅ | ✅ |
| `getMyOrderStatus` (`AUTHENTICATED_TOOLS`) | ❌ | ✅ | ❌ |
| `createDraftOrder` (`CHANNEL_ORDER_TOOLS`) | ❌ | ❌ | ✅ |

> Hoy `createDraftOrder` se habilita por `channel.kind === "whatsapp"`. Un cliente logueado en la web
> **no** puede crear borradores por el chat (usa el carrito/checkout normal).

## Máquina de estados (si aplica)

No hay máquina de estados conversacional. Hay un **loop agéntico** (`lib/llm/agent.js → runAgent`):

1. Arma `messages = [...history saneado, { role:"user", content: message }]`.
2. `provider.runTurn({ system, messages, tools })`.
3. Si el modelo **no** pide tools → devuelve su texto como `reply` (corta).
4. Si pide tool(s) → ejecuta cada una con `executeTool` (server-side), anexa `{ role:"tool", results }`
   y vuelve a 2.
5. Tope **`maxIterations = 6`**; si se agota, responde un texto de "reformulá".

**Best-effort:** el loop nunca propaga. Ante fallo del provider (red, sin API key, formato raro)
loguea y devuelve `FALLBACK_REPLY` en vez de un 500 crudo.

## Endpoints

| Método | Ruta | Middleware | Controller → Service |
|---|---|---|---|
| POST | `/store/chat/message` | `chatLimiter`, `optionalStoreAuth`, `validate(body: chatMessageBody)` | `ChatController.sendMessage` → `ChatModel.sendMessage` |

- Montado en `routes/store/index.js` → hereda `storeCors()` + `resolveTenantFromSlug` (tenant por slug).
- `optionalStoreAuth`: el bot funciona anónimo; con Bearer válido trae el `user`.
- Body (`schemas/chat.schema.js`): `message` (≤ 1000 chars), `history` (≤ 20 mensajes, content ≤ 2000).
- Respuesta: `{ reply: string }`.
- El canal WhatsApp **no** pasa por este endpoint: entra por el webhook (ver [[WhatsApp]]).

## Dependencias

- [[TenantConfig]] — marca para el system prompt y `showOutOfStock`. Si falla, el chat sigue (config `null`).
- [[Productos]] / [[Categorías]] / [[Órdenes]] — fuente de las tools (`ProductModel`, `CategoryModel`,
  `OrderModel`; `createDraftOrder` → `OrderModel.createDraft`).
- [[Cliente LLM]] / [[Agente LLM]] — `runAgent` + adapters de provider (`runTurn`).
- [[Redis y cache]] — backend del cost-guard (`consumeChatQuota`).
- [[Multi-tenancy]] — `req.tenantId` resuelto por slug.
- [[Rate limiting]] — `chatLimiter` (por IP) además del cost-guard por tenant.
- `helpers/price.js` (`getProductPrice`), `helpers/error.js` (`createError`).

## Integraciones externas

El proveedor LLM (Gemini o Anthropic, según `LLM_PROVIDER`), vía [[Cliente LLM]]. El chat usa el
camino **`runTurn`** (function calling), no `generate`.

> [!warning] El chat **solo funciona con Gemini hoy**
> `runTurn` está implementado en `providers/gemini.js`; en `providers/anthropic.js` **lanza
> `ANTHROPIC_CHAT_NOT_IMPLEMENTED`**. Con `LLM_PROVIDER=anthropic`, el loop captura el throw y
> devuelve `FALLBACK_REPLY` en cada turno → el chat queda inútil. (Nota: el ajuste de
> `ANTHROPIC_BASE_URL` para apuntar el adapter a Ollama en dev solo cubre `generate`/sugerencias de
> contenido, **no** el chat — ver [[Cliente LLM]].)

## Deuda técnica / cosas raras

- `[código-muerto]` / `[riesgo]` — **`anthropicProvider.runTurn` no implementado.** El chat asume
  Gemini; cambiar de provider lo rompe en silencio (cae al fallback amable). Decisión en Preguntas
  abiertas: implementarlo o documentar `LLM_PROVIDER=anthropic` como no soportado para chat.
- `[nota]` — **Stateless sin persistencia.** No se guarda ningún turno del chat web (`TODO(persistencia)`
  en `index.js`). El contrato ya está preparado para sumarla sin cambiar la firma del endpoint.
- `[nota]` — **`createDraftOrder` atado a `kind === "whatsapp"`** en dos lugares (`prompt.js` vía
  `canCreateOrders` y `tools.js` vía `orderToolsEnabled`/`CHANNEL_ORDER_TOOLS`). Si se suma otro canal
  con identidad (ej. Instagram DM), hay que tocar ambos; hoy es un string literal, no un flag de canal.

## Preguntas abiertas / mejoras candidatas

- ¿Implementar `runTurn` en el adapter Anthropic (para usar Claude/Ollama en el chat) o declarar
  oficialmente que el chat es Gemini-only?
- ¿Persistir la conversación (analítica, continuidad cross-device, auditoría de pedidos del bot)?
- ¿Habilitar `createDraftOrder` para clientes logueados en web, o queda exclusivo de canales tipo
  WhatsApp por diseño?
- ¿Generalizar la noción de "canal con identidad" a un flag en vez del literal `"whatsapp"`?
