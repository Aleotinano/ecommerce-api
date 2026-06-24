---
tags: [servicio, dominio/whatsapp]
estado: en-desarrollo
ultima-revision: 2026-06-24
---

# WhatsApp

Canal de entrada del **mismo chatbot** del storefront, vía WhatsApp Business (Meta Cloud API /
Graph API). No es un bot aparte: `WhatsappModel.processInbound` resuelve el tenant, recupera el
historial y delega en `ChatModel.sendMessage` como un **visitante anónimo**, después manda la
respuesta de vuelta por la Graph API.

> [!important] Reusa el motor, no lo reescribe
> Todo lo conversacional (tools, system prompt, seguridad de tenant, cost-guard) vive en
> [[Chat de tienda]]. Acá solo está lo **específico del canal**: webhook + firma, dedup, rate-limit
> por remitente, history en Redis, resolución de tenant por número y envío saliente.

## Propósito

Que una marca (tenant) atienda por WhatsApp con el mismo asistente del storefront. El cliente escribe
a un número de WhatsApp Business; el mensaje entra por webhook, lo procesa el chatbot y la respuesta
vuelve por la API de Meta. Habilita además el alta de **pedidos borrador** desde la conversación
(`createDraftOrder`), porque el canal aporta identidad de cliente (el `wa_id`).

## Modelo de datos

Sin tablas nuevas. El mapeo tenant ↔ número y el token viven en [[TenantConfig]]:

- `whatsappPhoneNumberId` — número de la marca (el que recibe). **Clave de resolución del tenant.**
- `whatsappAccessToken` — token saliente **cifrado** en reposo (AES-256-GCM, ver [[Crypto]]); se
  descifra on-the-fly. Si no hay, cae al token **global** de env (`WHATSAPP_ACCESS_TOKEN`).

Estado conversacional en **Redis** (no en DB), scopeado por tenant + `wa_id`:

| Uso | Key | TTL / límite |
|---|---|---|
| History corto | `t<tenantId>:wa:hist:<waId>` | TTL 1 h, últimos 10 mensajes |
| Rate-limit por remitente | `t<tenantId>:wa:rl:<waId>` | 20 / 60 s |
| Dedup de entregas | `t<tenantId>:wa:seen:<wamid>` | TTL 600 s (SET NX) |

## Reglas de negocio / invariantes

- **Firma obligatoria antes de confiar.** Se valida `X-Hub-Signature-256` (HMAC-SHA256 con el
  `WHATSAPP_APP_SECRET`) contra el **RAW body** (no el JSON re-serializado), en tiempo constante
  (`timingSafeEqual`). Firma inválida → **401**, sin procesar. Por eso el router monta su propio
  `express.json({ verify })` que guarda `req.rawBody`, montado **antes** del parser global en `app.js`.
- **200 inmediato + fire-and-forget.** Tras validar la firma se responde **200 al toque** y el
  procesamiento (tenant + LLM + envío) corre **después**, desacoplado. Meta reintenta ante cualquier
  no-200; por eso incluso un `phone_number_id` sin tenant devuelve 200 (se ignora en silencio).
- **Dedup antes del LLM.** Meta entrega *at-least-once* y puede redespachar el mismo `wamid`. El dedup
  (`isFirstDelivery`, SET NX) va **antes** del rate-limit y del LLM: sin él habría doble gasto de LLM +
  respuesta duplicada.
- **El tenant sale del número, nunca del payload-as-trusted.** `resolveTenantByPhoneNumberId` mapea
  `phone_number_id → TenantConfig`. Sin match o tenant inactivo → se ignora.
- **El remitente es siempre anónimo.** `ChatModel.sendMessage` se llama con `user: null` (igual que el
  web anónimo): **no** hay `getMyOrderStatus` por WhatsApp. Pero el `channel` (`{ kind:"whatsapp",
  waId, contactName }`) **sí** habilita `createDraftOrder`.
- **Token saliente fuera del alcance del cliente/LLM.** Lo resuelve el server (per-tenant cifrado o
  global). Un token corrupto no rompe el envío: se loguea y cae al de env.
- **v1 solo texto.** `extractTextMessages` filtra; los demás tipos (imagen, audio, status, reactions)
  se ignoran y se loguean (`extractIgnoredTypes`).
- **Módulo opcional.** Si faltan `WHATSAPP_APP_SECRET` o `WHATSAPP_ACCESS_TOKEN`, el webhook responde
  200 sin procesar y la app arranca igual (todas las env de WhatsApp son opcionales).

> [!warning] Tres degradaciones **distintas** ante Redis (no confundir)
> - **Cost-guard del chat** (`consumeChatQuota`, heredado de [[Chat de tienda]]) → **CERRADO**: sin
>   Redis no se llama al LLM (lanza 503, que acá se traga post-200).
> - **Rate-limit por `wa_id`** (`consumeWaQuota`) e **history** → **ABIERTO**: sin Redis se permite /
>   se responde sin continuidad. El gasto de LLM sigue protegido por el cost-guard del chat.
> - **Dedup** (`isFirstDelivery`) → **mixto**: sin Redis (deshabilitado) trata como primera entrega
>   (abierto); con Redis pero **error** descarta (cerrado), para no duplicar cobro.

## Máquina de estados (si aplica)

No aplica. Flujo lineal de `processInbound` (post-200):

```
1. resolveTenantByPhoneNumberId(phoneNumberId)   -> sin match: return
2. isFirstDelivery(wamid)        (dedup)         -> duplicado: return
3. consumeWaQuota(tenantId, waId) (rate-limit)   -> limitado: return
4. getHistory(tenantId, waId)     (Redis)
5. ChatModel.sendMessage({ user:null, channel:{kind:"whatsapp", waId, contactName} })
6. sendTextMessage(...)           (Graph API)
7. appendTurn(...)   solo si se envió (continuidad)
```

`processInbound` **captura sus propios errores**: corre sin request viva, así que loguea y traga
(incluye 429/503 del cost-guard → para el usuario de WhatsApp degrada en silencio).

## Endpoints

Montado en `app.js` → `app.use("/webhooks/whatsapp", whatsappWebhookRouter)`, **antes** del
`express.json` global.

| Método | Ruta | Handler | Para qué |
|---|---|---|---|
| GET | `/webhooks/whatsapp` | `WhatsappWebhookController.verify` | Handshake de Meta: si `hub.mode=subscribe` y `hub.verify_token === WHATSAPP_VERIFY_TOKEN`, devuelve `hub.challenge` en texto plano; si no, 403. |
| POST | `/webhooks/whatsapp` | `jsonWithRawBody` → `WhatsappWebhookController.receive` | Recepción: valida firma, responde 200, procesa async. |

Saliente: `POST https://graph.facebook.com/{version}/{phoneNumberId}/messages` con
`Authorization: Bearer {token}` (`sendTextMessage`, `graph-api.js`). Versión por
`WHATSAPP_GRAPH_API_VERSION` (default `v21.0`).

## Dependencias

- [[Chat de tienda]] — el motor (`ChatModel.sendMessage`). **Dependencia central.**
- [[TenantConfig]] — `whatsappPhoneNumberId` + `whatsappAccessToken` (resolución de tenant y token).
- [[Crypto]] — `decryptSecret` para el token per-tenant.
- [[Redis y cache]] — history, rate-limit y dedup (`tenantNs`).
- [[Órdenes]] — destino de `createDraftOrder` (`OrderModel.createDraft`, origen BOT).
- [[Multi-tenancy]] — resolución por número (no por slug/host, a diferencia del resto del storefront).
- `config.js` (`DEFAULTS.WHATSAPP.*`), `schemas/whatsapp.schema.js` (parseo defensivo del payload).

## Integraciones externas

**Meta WhatsApp Cloud API (Graph API).** Entrante: webhook con verificación de firma. Saliente: envío
de mensajes de texto. En dev se usa un único número/token de prueba desde env; en prod el token sale
por tenant (cifrado en DB).

## Deuda técnica / cosas raras

- `[riesgo]` — **Fire-and-forget en proceso.** El procesamiento corre inline tras el 200 (no hay cola).
  Si el proceso muere entre el 200 y el envío, el mensaje se pierde sin reintento propio. El código lo
  marca: `NOTA(prod): encolar acá (p. ej. BullMQ)`.
- `[nota]` — **Solo texto (v1).** Imágenes/audio/ubicación se ignoran. Un cliente que manda una foto no
  recibe respuesta útil.
- `[nota]` — **`createDraftOrder` disponible para cualquier `wa_id`** (anónimo, sin verificación de
  identidad más allá del número de WhatsApp). Es por diseño (el pedido nace sin revisar y un humano lo
  valida), pero conviene tenerlo presente como superficie de abuso —mitigado por `consumeWaQuota` y el
  cost-guard del chat.
- `[nota]` — El stub previo mencionaba `WHATSAPP_MOCK_SEND`; **no existe** en el código actual
  (`graph-api.js` siempre hace el `fetch` real). Para no pegarle a Meta en dev se usa un número de
  prueba, no un flag de mock.

## Preguntas abiertas / mejoras candidatas

- ¿Mover el procesamiento a una cola (BullMQ u otra) para reintentos y desacople real del webhook?
- ¿Soportar tipos no-texto (al menos imágenes de producto entrantes / respuestas con media)?
- ¿Es WhatsApp el punto de entrada del flujo de seña de [[Órdenes]]? Hoy `createDraftOrder` ya crea la
  orden con `requiresDeposit`/`depositAmount` según `TenantConfig.depositEnabled`, así que el flujo de
  seña **ya está cableado** por este canal (el TBD histórico de [[Órdenes]] quedó cubierto).
- ¿Notificar al cliente por WhatsApp los cambios de estado de su pedido (saliente proactivo, no solo
  respuesta)?
