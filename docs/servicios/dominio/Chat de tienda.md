---
tags: [servicio, dominio/chat]
estado: TBD
ultima-revision: 2026-06-20
---

# Chat de tienda

> [!todo] Pendiente de documentar
> Stub generado en Fase 3. Fuentes a leer: `services/chat/*` (`index.js`, `tools.js`, `prompt.js`,
> `cost-guard.js`), `controllers/store/chat.js`, `routes/store/chat.js`, `schemas/chat.schema.js`.
> Asistente conversacional público/anónimo del storefront con tool-calling sobre el catálogo (ver
> [[Agente LLM]]). `estado: TBD` (ver convención en [[_index]]).

> [!warning] Invariante clave a NO perder al documentar
> Este es el **hogar** de la decisión **fail-closed**: `consumeChatQuota`
> (`services/chat/cost-guard.js`) degrada **CERRADO** — si Redis no está o falla, lanza `503` y **no**
> llama al LLM, para no exponer la API key a abuso en un endpoint anónimo. Documentar como invariante
> acá; [[WhatsApp]] la hereda vía `ChatModel`, y [[Redis y cache]] debe referenciarla como la excepción
> a "degradar-abierto".

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
