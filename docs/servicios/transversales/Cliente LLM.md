---
tags: [abstraccion, transversal/llm]
estado: TBD
ultima-revision: 2026-07-22
lado: backend
---

# Cliente LLM

> [!todo] Pendiente de documentar
> Stub generado en Fase 3. Fuentes a leer: `lib/llm/index.js` (`generateCopy`, `refineCopy`),
> `lib/llm/prompt.js`, `lib/llm/parse.js`, `lib/llm/fallback.js`, `lib/llm/providers/anthropic.js`,
> `lib/llm/providers/gemini.js`, `schemas/env.schema.js`. Fachada provider-agnóstica (`LLM_PROVIDER`,
> default `gemini`); **best-effort, nunca lanza**: fallback por template con `model: null`. Lo consume
> [[Sugerencias de contenido]] y [[Agente LLM]]. `estado: TBD` (ver convención en [[App]]).
>
> **Actualización (2026-07-22):** esta lista de fuentes ya no cubre todo lo que vive bajo el mismo
> paraguas de "Cliente LLM" — falta `lib/llm/image.js`, `lib/llm/image-prompt.js` y
> `lib/llm/providers/gemini-image.js` (cliente de **imagen**, ya implementado, ver
> [[Sugerencias de contenido — Imágenes (propuesta)]]), que comparten el mismo patrón fachada
> provider-agnóstica + best-effort. Al redactar el doc, decidir si el cliente de imagen es parte de
> este documento o merece uno propio — pero no ignorarlo, ya existe en el mismo directorio.

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
