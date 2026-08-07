---
tags: [abstraccion, transversal/auth]
estado: TBD
ultima-revision: 2026-07-22
lado: backend
---

# Auth y tokens

> [!todo] Pendiente de documentar
> Stub generado en Fase 3. Fuentes a leer: `middleware/auth.js` (`verifyToken`, `verifyStoreToken`),
> `lib/tokens.js`. Relación con [[Usuarios y Auth]], [[Roles]], [[Multi-tenancy]]. `estado: TBD` (ver
> convención en [[App]]).
>
> **Corrección (2026-07-22) al enunciado anterior de este callout**: decía "capturar los dos flujos de
> autenticación Bearer (backoffice vs storefront)", pero solo uno es Bearer. `verifyToken`
> (backoffice, `middleware/auth.js:12-13`) es **cookie-only** — lee `req.cookies.access_token` e
> **ignora** el header `Authorization` por completo. `verifyStoreToken`/`optionalStoreAuth`
> (storefront, vía `extractToken`) sí soportan `Authorization: Bearer` con fallback a cookie. Al
> redactar el doc, precisar esta asimetría en vez de llamar "Bearer" a ambos flujos.

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
