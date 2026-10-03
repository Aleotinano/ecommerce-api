---
tags: [editflow, arquitectura, convenciones]
estado: propuesta
ultima-revision: 2026-10-03
---

# Arquitectura de EditFlow

Lo que vale para todo el código. Un módulo nuevo no decide nada de esto: lo sigue.

## 1. Stack

| Capa | Elección | Por qué |
| --- | --- | --- |
| Runtime | Node 24 | El de Cori; mismo Dockerfile |
| API | Express 5 + Zod 4 | Lo que ya conocés; los middlewares de Cori se copian casi tal cual |
| DB | PostgreSQL + Prisma 7 (`@prisma/adapter-pg`) | Igual que Cori, incluido el cliente generado fuera de `node_modules` |
| Lenguaje | **TypeScript en todo** (`tsx` en dev, `tsc` en build) | Un solo contrato de tipos entre API y web |
| Web | Next 16 + React 19 + HeroUI 3 + Tailwind 4 | El admin de Cori; su shell y sus componentes se copian |
| Formularios | react-hook-form + el mismo schema Zod de la API | La validación del front y la del back son la misma |
| Tests | Vitest + Supertest (API), DB de test aparte | Igual que Cori: `DATABASE_URL` tiene que contener `_test` |
| Gestor | pnpm workspaces | Igual que el front de Cori |

Redis, Cloudinary, mailer, WhatsApp, MercadoPago y LLM **no entran en la fase 1**. Cada uno
tiene su archivo listo para copiar en [REUTILIZACION.md](./REUTILIZACION.md) cuando haga falta.

## 2. El monorepo

```
editflow/
├── apps/
│   ├── api/                     # Express + Prisma
│   └── web/                     # Next: el panel (admin y editores)
├── packages/
│   └── shared/                  # Contratos: schemas Zod, tipos inferidos, enums, cálculo puro
├── docs/                        # Esta carpeta, y una nota por módulo
├── docker-compose.yml           # postgres + api (+ redis cuando haga falta)
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── CLAUDE.md                    # Reglas para el agente (ver §8)
```

### `packages/shared` es el contrato

Se llama `@repo/shared` y tiene el **mismo layout que en Cori** (sin `src/`), para que los
archivos copiados importen igual que allá (`@repo/shared/lib/api-error`).

```
packages/shared/
├── schemas/        # NUEVO. Zod: client.schema.ts, batch.schema.ts, video.schema.ts …
├── types/          # z.infer<> de los schemas + tipos de respuesta. auth/sideBar/context copiados
├── domain/         # NUEVO. PURO, sin I/O: video-state.ts, pricing.ts
├── lib/            # copiado: api-error, format, storage, toast, query, url, phone
├── hooks/          # copiado: useRevalidateOnFocus
└── components/     # copiado: PasswordInput, PasswordStrength, ThemeSwitcher
```

- Un schema se escribe **una vez**: la API lo usa en `validate()` y el front en
  `zodResolver()`. Cori duplica esto a mano entre `schemas/*.js` y `packages/shared/types/`,
  y esa duplicación es la que se desincroniza.
- `domain/` no importa nada de Prisma, Express ni React. Si lo necesitan los dos lados (el
  precio de una tanda se muestra antes de crearla y se recalcula al guardarla), vive acá.
- La API lo consume como dependencia de workspace (`"@repo/shared": "workspace:*"`) igual que
  la web.

## 3. La API

```
apps/api/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── scripts/             # create-agency.ts, seed-dev.ts (NUNCA un TRUNCATE en algo que no sea dev)
├── src/
│   ├── app.ts               # arma Express: middlewares globales + montaje de módulos
│   ├── server.ts            # listen. Separado para que los tests importen app sin abrir puerto
│   ├── config/
│   │   ├── env.ts           # schema Zod del entorno; el arranque falla si falta algo
│   │   └── index.ts         # DEFAULTS derivados (orígenes, trust proxy…)
│   ├── lib/                 # infraestructura sin dominio: prisma, logger, errors, password, tokens
│   ├── http/
│   │   ├── middleware/      # auth, require-role, validate, error-handler, cors, rate-limit, http-logger
│   │   └── router.ts        # monta cada módulo bajo su prefijo
│   └── modules/
│       ├── auth/
│       ├── agencies/
│       ├── users/           # admins y editores
│       ├── clients/
│       ├── services/        # catálogo de tipos de video y sus escalones de precio
│       ├── batches/         # tandas
│       ├── videos/
│       └── dashboard/       # solo lectura: los agregados del panel
└── tests/
    ├── setup/               # global-setup.ts, factories.ts
    └── isolation.test.ts    # una agencia nunca ve datos de otra (ver §5)
```

### Un módulo

```
modules/clients/
├── clients.routes.ts        # Router: ruta → middlewares → controller. Nada más
├── clients.controller.ts    # req → service → res. Sin Prisma, sin reglas de negocio
├── clients.service.ts       # La lógica. Recibe { agencyId, … }, devuelve datos, tira AppError
├── clients.queries.ts       # (opcional) selects/includes reutilizados del módulo
└── clients.test.ts
```

Las reglas que sostienen esto:

1. **El controller no toca Prisma.** Si un controller tiene un `prisma.`, falta un método en
   el service.
2. **El service no conoce `req` ni `res`.** Recibe un objeto plano con `agencyId` explícito y
   se puede llamar desde un script, un test o un job igual que desde HTTP.
3. **Los errores son `AppError(message, code, status)`** (el `createError` de Cori) y los
   responde un solo `errorHandler`. El `code` es estable (`CLIENT_NOT_FOUND`) y es lo que el
   front lee; el `message` es para humanos.
4. **Validación en la frontera**: `validate({ body, params, query })` con los schemas de
   `@repo/shared`. Lo que llega al controller ya está tipado y limpio.
5. **Un módulo no importa el service de otro** salvo para leer. Si dos módulos escriben juntos
   (crear una tanda crea sus videos), uno es el dueño de la transacción.
6. **Toda escritura de varias filas va en `prisma.$transaction`.**

## 4. Formato de la API

- REST bajo `/api/v1`. Recursos en plural: `/clients`, `/clients/:id/batches`, `/videos/:id`.
- Respuesta OK: el recurso tal cual (`{ id, name, … }`) o `{ items, total }` en listados.
- Respuesta de error, siempre: `{ error: { message, code, details? } }`.
- Cambio de estado = **acción explícita**, no PATCH del campo:
  `POST /videos/:id/transitions { to: "EN_REVISION" }`. Así la máquina de estados es la
  única que decide, y el historial se escribe en el mismo lugar.
- Paginación `?limit=&offset=` con tope (Cori usa 100).
- Fechas en ISO UTC; plata en **enteros de pesos** (sin centavos: es lo que se cobra en el
  rubro y elimina el redondeo).

## 5. Multi-agencia (tenancy)

- Toda tabla de negocio tiene `agencyId` + índice. Sin excepción.
- El `agencyId` sale **del token**, nunca del body ni de la URL.
- Todo `findUnique` por id pasa a `findFirst({ where: { id, agencyId } })`: un id de otra
  agencia responde 404, no 403 (no se confirma que existe).
- `tests/isolation.test.ts` crea dos agencias y prueba, endpoint por endpoint, que la B no
  lee ni escribe nada de la A. Es el test que Cori tiene (`isolation*.test.js`) y el que más
  bugs le encontró.

## 6. Autenticación y roles

- Login con email + contraseña (argon2), JWT en **cookie httpOnly** (`access_token`), igual
  que el panel de Cori, con sus atributos cross-site ya resueltos (ver
  `front-md-guia/COOKIE_PANEL_CROSS_SITE.md` en Cori).
- Roles: `OWNER` (dueño de la agencia: todo, incluida la plata), `ADMIN` (todo menos
  facturación/usuarios), `EDITOR` (solo sus clientes y sus videos).
- `requireRole([...])` en la ruta + **filtro por dueño en el service** para `EDITOR`: el rol
  dice qué endpoints puede llamar, el service dice qué filas puede ver. Las dos cosas.
- Clientes con login propio: fuera de la fase 1 (pregunta abierta).

## 7. El panel web

Se copia el shell del admin de Cori y su **patrón de módulo** (`docs/PATRON_DE_MODULO.md` del
front de Cori): una página que lista, un riel que inspecciona lo seleccionado y un formulario
que aparece al entrar a un bloque del riel.

```
apps/web/
├── app/
│   ├── (auth)/login, …                  # copiado de Cori
│   └── dashboard/                       # mismas rutas base que el admin de Cori
│       ├── page.tsx                     # Dashboard
│       ├── clientes/page.tsx
│       ├── tandas/page.tsx
│       ├── videos/page.tsx              # el tablero: todos los videos por estado
│       ├── editores/page.tsx
│       └── servicios/page.tsx           # lista de precios
├── components/
│   ├── auth/                            # copiado
│   ├── shared/                          # DataTable, ListRow, AlertCard, EmptyState… (copiado)
│   └── dashboard/
│       ├── layout/                      # sidebar, header, SidePanel, TabSlider… (copiado)
│       ├── panel/                       # PanelCommandCard, PanelSection, FormSection… (copiado)
│       └── pages/<módulo>/              # hooks/ panel/ ui/ utils/ — el patrón de Cori
├── context/                             # Auth, SidePanel, PageMeta, HeaderSlot (copiados) + <Módulo>Panel
├── hooks/
├── lib/api.ts                           # fetcher con credentials + ApiError (copiado)
└── services/<módulo>.service.ts         # una función por endpoint, tipada con @repo/shared
```

**Las carpetas copiadas conservan la MISMA ruta que en Cori** (`components/dashboard/panel/…`,
`components/shared/ui/…`). No es por gusto: así los imports `@/components/…` de lo copiado
resuelven sin tocar una línea, y comparar un archivo contra su original de Cori es un `diff`
directo. Lo nuevo de EditFlow vive en `components/dashboard/pages/<módulo>/`.

Reglas del front (las de Cori que aplican):

- **Sin estilos inline ni valores arbitrarios de Tailwind**: todo valor es un token de
  `globals.css`.
- `utils/` no tiene JSX; los mapas de dominio (estado → color, estado → rótulo) son **datos**.
- El nombre visible de un estado sale de **un solo lugar** (`packages/shared/domain/video-state.ts`),
  no de quien dibuja la pantalla (como `order-status.js` en Cori).
- Nada de `if (role === "EDITOR")` desperdigado: el front pregunta por una capacidad
  (`can.seePrices`) que sale de un solo mapa.

## 8. CLAUDE.md del repo nuevo

El agente trabaja mucho mejor con reglas escritas. El `CLAUDE.md` raíz lleva, como mínimo:

- Los 6 puntos de §3 y los de §5 tal cual.
- "Antes de crear un componente, buscá en `components/ui` y `components/panel`."
- "Toda migración nueva: `prisma migrate dev --name <verbo_objeto>`; nunca editar una migración ya aplicada."
- "Un cambio de dominio actualiza su nota en `docs/`."
- Comandos: `pnpm dev`, `pnpm test`, `pnpm typecheck`, `pnpm lint`.

El admin de Cori tiene un `CLAUDE.md` con sus reglas numeradas (regla 0 = sin inline, regla
2 = qué componente para qué…) que **no está commiteado** en el repo; si lo tenés local,
copialo como base del de `apps/web`.

## 9. Calidad mínima desde el commit 1

- `pnpm typecheck` + `pnpm lint` + `pnpm test` en CI (GitHub Actions) en cada push.
- ESLint con config **commiteada** (el front de Cori no tiene una y `pnpm lint` no corre).
- Un test por regla de negocio pura (`domain/`) y uno de integración por endpoint.
- Seeds de dev idempotentes, separados de cualquier script que borre.
