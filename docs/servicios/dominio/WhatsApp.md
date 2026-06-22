---
tags: [servicio, dominio/whatsapp]
estado: TBD
ultima-revision: 2026-06-20
---

# WhatsApp

> [!todo] Pendiente de documentar
> Stub generado en Fase 3. Fuentes a leer: `services/whatsapp/*` (`index.js`, `signature.js`,
> `history.js`, `rate-limit.js`, `graph-api.js`, `dedup.js`, `tenant-resolver.js`),
> `controllers/webhooks/whatsapp.js`, `routes/webhooks/whatsapp.js`, `schemas/whatsapp.schema.js`.
> Webhook de WhatsApp Business (Meta Graph API): verificación de firma, dedup, resolución de tenant por
> `whatsappPhoneNumberId`, token por tenant cifrado ([[Crypto]]) con fallback al global. `estado: TBD`.

> [!note] Hilos a capturar al documentar
> - **Degradación del cost-guard del LLM:** la guarda **fail-closed** vive en [[Chat de tienda]]
>   (`consumeChatQuota`) y aplica acá porque el flujo pasa por `ChatModel`. El rate-limit **propio** de
>   WhatsApp (`consumeWaQuota`, por `wa_id`) degrada **ABIERTO** (sin Redis, deja pasar): no confundir
>   ambas guardas.
> - **Flags de entorno:** revisar `WHATSAPP_MOCK_SEND` (modo mock de envío) y el token global
>   `WHATSAPP_ACCESS_TOKEN` vs. el token por tenant.
> - Posible punto de entrada del futuro flujo de seña de [[Órdenes]] (ver TBD allí).

## Propósito
> [!todo] Pendiente de documentar

## Modelo de datos
> [!todo] Pendiente de documentar

## Reglas de negocio / invariantes
> [!todo] Pendiente de documentar

## Máquina de estados (si aplica)
> [!todo] Pendiente de documentar

## Endpoints
> [!todo] Pendiente de documentar

## Dependencias
> [!todo] Pendiente de documentar

## Integraciones externas
> [!todo] Pendiente de documentar

## Deuda técnica / cosas raras
> [!todo] Pendiente de documentar

## Preguntas abiertas / mejoras candidatas
> [!todo] Pendiente de documentar
