---
tags: [abstraccion, transversal/multi-tenancy]
estado: TBD
ultima-revision: 2026-07-22
lado: backend
---

# Multi-tenancy

> [!todo] Pendiente de documentar
> Stub generado en Fase 3. Fuentes a leer: `middleware/tenant.js`, modelo `Tenant` y los `@@index([tenantId])`
> de `prisma/schema.prisma`. `estado: TBD` (ver [[App]]).
>
> **Corrección (2026-07-22) al enunciado anterior de este callout**: decía que `req.tenantId`
> "nunca llega del cliente" — es inexacto. `middleware/tenant.js:resolveSlug` resuelve el slug del
> tenant por **subdominio del host o por el header `X-Tenant-Slug`**, y ese header lo manda el
> cliente literalmente (`req.get("x-tenant-slug")`), sin allowlist de origen. En rutas con sesión se
> revalida contra el `tenantId` embebido en el JWT (`middleware/auth.js:verifyStoreToken`, 403 si no
> coinciden) — esa es la garantía real, no que el dato "nunca" venga de afuera. Además: **no hay
> soporte de dominio custom** (el hostname debe tener ≥3 partes para extraer un subdominio) y **no
> hay scoping automático de `tenantId` a nivel de Prisma** — no existe ninguna extensión/middleware de
> cliente que lo inyecte; cada query de cada servicio agrega `where: { tenantId }` a mano, por
> convención, no por garantía del ORM (riesgo ya señalado en `docs/ARCHITECTURE.md`).

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
