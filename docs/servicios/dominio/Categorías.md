---
tags: [servicio, dominio/categorias]
estado: estable
ultima-revision: 2026-07-22
lado: backend
---

# Categorías

## Propósito
Árbol de categorías/subcategorías por tenant para clasificar productos, con soporte de imagen (subida
directa o URL externa) e ícono. Sostiene el filtro de catálogo del storefront y la navegación del panel
admin.

## Modelo de datos
Fuente: `prisma/schema.prisma` (modelo `Categories`; nombre del archivo/servicio en inglés
`categories`, aunque en la prosa del producto se hable de "categorías").

- **`Categories`** — `tenantId`, `name` (único por tenant), `description?`, `icon?` (string libre,
  ej. nombre de ícono), `imageUrl?`, `imgPublicId?` (Cloudinary), `isActive=true`, `parentId?`
  (self-relation `parent`/`children`, árbol de un tenant), `position` (`Int @default(0)`, agregado
  2026-07-20 — orden de display dentro de su nivel). Relación `products: Product[]` y
  `comboAllowedIn: ComboAllowedCategory[]` (ver [[Combos]]).
- Índice único `(tenantId, name)`.
- **Orden de listado**: `getTree`/`getAll` ordenan `orderBy: [{ position: "asc" }, { id: "asc" }]`
  (`services/categories.js`) — antes de agregarse `position`, el orden implícito era por id de
  creación; hoy es configurable. No hay un endpoint dedicado de "reordenar": se setea `position` vía
  el mismo `PATCH /:id` genérico, moviendo una categoría a la vez.

## Reglas de negocio / invariantes
- **Nombre único por tenant**: `create`/`edit` rechazan con `409 CATEGORY_ALREADY_EXISTS` si ya existe
  otra categoría con el mismo `name` en el tenant (case-sensitive, comparación directa de Prisma).
- **Jerarquía sin ciclos**: `ensureNoCircularHierarchy` recorre la cadena de `parentId` hacia arriba al
  editar; si `parentId === id` propio (`400 INVALID_PARENT_CATEGORY`) o si en algún punto de la cadena
  se vuelve a llegar al propio `id` (`400 CATEGORY_CIRCULAR_HIERARCHY`), rechaza. Solo corre si
  `parentId` viene definido en el PATCH.
- **`parentId` debe existir y pertenecer al tenant** (`ensureParentExists`), si no `404
  PARENT_CATEGORY_NOT_FOUND`.
- **Borrado bloqueado si tiene relaciones**: no se puede borrar una categoría con productos asociados
  (`409 CATEGORY_HAS_PRODUCTS`) ni con subcategorías (`409 CATEGORY_HAS_CHILDREN`) — hay que
  reasignar/vaciar primero. `create`/`edit`/`delete` corren dentro de `prisma.$transaction` para que la
  validación y la escritura sean atómicas.
- **Imagen: dos caminos coexisten** — subida multipart a Cloudinary (`uploadImage` +
  `normalizeMultipartBody` en la ruta) o `imageUrl` como string plano (para pegar una URL externa). En
  `edit`, si llega un archivo nuevo o un `imageUrl` distinto al existente, se borra la imagen anterior
  de Cloudinary **después** de confirmar el update; si `create`/`edit` fallan tras subir la imagen
  nueva, se hace rollback borrándola del `catch`. `delete` también borra la imagen de Cloudinary al
  borrar la categoría.
- **`updateCategory` (schema) no exige "al menos un campo"** (`.strip()` sin refine) — lo corta
  `requireBodyOrImage` en la ruta, porque un update que solo manda imagen (sin JSON body) es válido y
  ese refine lo hubiera rechazado incorrectamente.
- **Cache**: `getTree` cachea 300s (`wrap`, key `t<tenantId>:cat:tree`); cualquier escritura invalida
  todo el patrón `t<tenantId>:cat:*`.

## Endpoints

### Backoffice — `routes/categories.js` (montado en `/categories`, auth `verifyToken`)

| Método | Ruta | Qué hace | Auth / rol |
| --- | --- | --- | --- |
| GET | `/` | Lista plana; `?includeChildren=true` incluye hijos directos por fila | Usuario autenticado |
| GET | `/tree` | Árbol completo `parent`/`children` anidado, cacheado | Usuario autenticado |
| GET | `/:id` | Detalle con `parent` y `children` | Usuario autenticado |
| POST | `/` | Crea (multipart, imagen opcional) | `ADMIN` / `STAFF` |
| PATCH | `/:id` | Edita campos + imagen; `requireBodyOrImage` exige al menos uno | `ADMIN` / `STAFF` |
| DELETE | `/:id` | Borra si no tiene productos ni hijos + borra imagen de Cloudinary | `ADMIN` / `STAFF` |

### Storefront — `routes/store/categories.js` (auth `optionalStoreAuth`)

| Método | Ruta | Qué hace |
| --- | --- | --- |
| GET | `/` | Lista plana pública |
| GET | `/tree` | Árbol público (mismo `CategoryModel.getTree`) |
| GET | `/:id` | Detalle público — **incluye `parent`/`children` igual que el admin**, no hay una versión "reducida" para el storefront |

Ambos lados llaman al mismo `CategoryModel` — no hay lógica distinta en el controller de store, solo un
wrapper delgado sobre el mismo servicio. Validación: `schemas/category.schema.js` (`createCategory`,
`updateCategory`); `validateId`/`categoryId` para el param `:id`.

## Dependencias
- [[Productos]] — `Product.categoryId` referencia esta tabla; `delete` chequea productos asociados.
- [[Combos]] — `ComboAllowedCategory` referencia una `Categories` para whitelistear categorías enteras
  dentro de un combo.
- [[Almacenamiento de imágenes]] (Cloudinary) — imagen de categoría.
- [[Redis y cache]] — cache del árbol (300s).
- [[Multi-tenancy]] — todo scoping por `tenantId`.

## Integraciones externas
- **Cloudinary** para la imagen de categoría (subida directa) o simplemente una URL externa validada
  por schema (sin integración, solo formato).

## Deuda técnica / cosas raras
Etiquetas por tipo de acción — ver convención en [[App]].

- `[nota]` Naming: archivos/modelo en inglés (`categories.js`, `Categories`) mientras el dominio del
  producto conversa en español ("categorías"). Informativo, no bloqueante.
- `[nota]` `GET /:id` del storefront devuelve `parent`/`children` igual que el admin — no hay
  necesidad hoy de una versión reducida, pero si el árbol crece podría valer la pena limitar el payload
  público.

## Preguntas abiertas / mejoras candidatas
- ¿Conviene un endpoint de reorden batch (`PATCH /reorder` con una lista de `{id, position}`) ahora
  que `position` es real, en vez de mover una categoría a la vez vía `PATCH /:id`?
