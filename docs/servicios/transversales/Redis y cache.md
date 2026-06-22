---
tags: [abstraccion, transversal/redis]
estado: TBD
ultima-revision: 2026-06-20
---

# Redis y cache

> [!todo] Pendiente de documentar
> Stub generado en Fase 3. Fuentes a leer: `lib/cache.js` (`get`, `set`, `tenantNs`), `lib/redis.js`
> (`getRedis`). Patrón de namespacing por tenant y degradación ante Redis caído. `estado: TBD` (ver [[_index]]).

> [!warning] No pintar la degradación como uniforme
> La política es **MIXTA**, no todo "degradar-abierto":
> - **Abierto** (disponibilidad > falso negativo): cache (`lib/cache.js`), cost-guard de
>   [[Sugerencias de contenido]] (`consumeLlmQuota`), rate-limit por `wa_id` de [[WhatsApp]]
>   (`consumeWaQuota`).
> - **Cerrado** (no exponer la API key): el cost-guard del chatbot público en [[Chat de tienda]]
>   (`consumeChatQuota`) → sin Redis, `503` y no llama al LLM.
> Documentar ambas y referenciar el hogar de cada decisión; si no, el doc miente en la decisión más
> importante.

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
