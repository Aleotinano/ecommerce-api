---
tags: [servicio, dominio/roles]
estado: estable
ultima-revision: 2026-07-28
lado: backend
---

# Roles

## Propósito
Gestión del rol de un usuario dentro de un tenant. No hay un "servicio de roles" en el sentido de
una entidad propia — es en la práctica un único endpoint que edita `User.role`.

## Modelo de datos
No tiene tabla propia. Enum `Role` (`prisma/schema.prisma`) = `ADMIN | STAFF | CUSTOMER`, campo
`User.role`.

## Reglas de negocio / invariantes
- **`roleModel.edit`** (`services/role.js:4-19`): busca el usuario por `{ id, tenantId }` (scoping
  correcto por tenant), `404 USER_NOT_FOUND` si no existe, y actualiza `role` directo — sin
  restricción adicional. No impide que un `ADMIN` se autodegrade, ni valida que quede al menos un
  `ADMIN` en el tenant tras el cambio.
- **`requireRole`** (`middleware/role.js:1-23`): `401` si no hay `req.user`, `403` con
  `{ requiredRole, username, yourRole }` si el rol no está en la whitelist permitida por la ruta —
  reusado en prácticamente todos los routers de backoffice (orders, tenant-config, stats, products,
  categories, etc.).

## Endpoints

| Método | Ruta | Qué hace | Auth / rol |
| --- | --- | --- | --- |
| PATCH | `/users/:id` | Cambia el `role` de un usuario del tenant; body `{ role }` validado contra el enum (`schemas/role.schema.js`) | `verifyToken` + `ADMIN` |

> El archivo se llama `routes/role.js` y el router `roleRouter`, pero `app.js` lo monta en **`/users`**
> (`app.use("/users", roleRouter)`), no en `/role`. Esta doc decía `/role/:id` hasta el 2026-07-28.

No existe endpoint de listado/lectura de roles — solo edición.

## Dependencias
- [[Usuarios y Auth]] — `User.role` es el campo que este servicio edita.
- [[Multi-tenancy]] — scoping de `{ id, tenantId }` al buscar el usuario a editar.
- Consumido transversalmente por `requireRole` en casi todos los routers de backoffice.

## Integraciones externas
Ninguna.

## Deuda técnica / cosas raras
Etiquetas por tipo de acción — ver convención en [[App]].

- `[riesgo]` **Sin protección contra lock-out**: `roleModel.edit` no impide que el único `ADMIN`
  restante de un tenant pierda ese rol (ni que se autodegrade). Un tenant podría quedarse sin ningún
  `ADMIN` capaz de revertir el cambio.

## Preguntas abiertas / mejoras candidatas
- ¿Debería `roleModel.edit` impedir que el último `ADMIN` de un tenant pierda ese rol (lock-out)?
