---
tags: [editflow, prompts, plan]
estado: propuesta
ultima-revision: 2026-10-03
---

# Construir EditFlow por fases

Un prompt por fase, para una sesión de agente cada uno. Están escritos para pegarse tal cual:
cada uno dice qué leer, qué hacer, qué NO hacer y cuándo está terminado.

**Por qué por fases y no un prompt gigante:** cada fase termina con algo que corre y tiene
tests. Si una sesión se desvía, se pierde una fase, no el proyecto; y lo que se revisa en cada
PR entra en una lectura.

**Antes de la fase 0:** responder las preguntas de [DOMINIO.md §7](./DOMINIO.md#7-preguntas-abiertas)
y anotar las respuestas en ese archivo. Las fases 2 en adelante las leen de ahí.

---

## Fase 0 — El esqueleto y la copia

```text
Vamos a arrancar EditFlow, un software para gestionar una agencia de edición de video.
Leé, en este orden: docs/editflow/README.md, ARQUITECTURA.md y REUTILIZACION.md (si no
están en este repo, están en el repo ecommerce-api, carpeta docs/editflow/; copialas a docs/).

1. Armá el monorepo pnpm de ARQUITECTURA.md §2: apps/api, apps/web, packages/shared.
2. Corré docs/copiar-desde-cori.sh contra los clones de Cori (ecommerce-api y
   e-commerce-nextjs). No edites a mano lo que copia el script.
3. apps/web: que levante con `pnpm dev:web` mostrando la pantalla de login copiada. Cambiá
   solo lo imprescindible para que compile (nombre del paquete, marca en
   lib/platform-brand.ts). Las rutas del dashboard de Cori NO se copian: dejá
   app/dashboard/page.tsx con un placeholder.
4. apps/api: package.json en TypeScript (tsx en dev, tsc en build), un app.ts con /health
   y nada más. NO conviertas todavía lo de _from-cori/: es la fase 1.
5. Scripts raíz: dev, dev:api, dev:web, build, typecheck, lint, test. ESLint con config
   commiteada (flat config) para los tres paquetes.
6. CI en GitHub Actions: install, typecheck, lint, test.
7. CLAUDE.md raíz con las reglas de ARQUITECTURA.md §8.

Terminado cuando: `pnpm typecheck` y `pnpm lint` pasan, `pnpm dev` levanta la web con el
login y la API responde /health, y CI está verde.
```

## Fase 1 — La API base: agencia, usuarios y auth

```text
Fase 1 de EditFlow. Leé CLAUDE.md, docs/ARQUITECTURA.md §3–§6 y docs/REUTILIZACION.md
§3 (tabla del backend).

1. Pasá a TypeScript lo de apps/api/_from-cori/ a su lugar en src/ según la tabla
   (columna "Qué cambia"). Conservá la línea "// Origen: Cori …" de cada archivo. Al
   terminar, borrá _from-cori/ salvo REFERENCIA/.
2. Prisma: Agency, User (roles OWNER | ADMIN | EDITOR). Migración `init_agency_users`.
3. Módulo auth: login, logout, me. JWT en cookie httpOnly `access_token` con los atributos
   de docs/cori/COOKIE_PANEL_CROSS_SITE.md. El token lleva { userId, agencyId, role }.
4. Módulo users: listar, crear, editar, desactivar (nunca borrar) — solo OWNER/ADMIN.
5. prisma/scripts/create-agency.ts (desde create-tenant de Cori): crea la agencia y su OWNER
   por consola; la contraseña se imprime una vez o sale de ADMIN_PASSWORD.
6. Tests: global-setup que exige DATABASE_URL con "_test"; factories buildAgency(); un test
   por endpoint; tests/isolation.test.ts con dos agencias (ARQUITECTURA.md §5).
7. apps/web: conectá el login copiado a esta API. Después del login, el dashboard vacío
   con el sidebar y el nombre del usuario.

NO: clientes, tandas ni videos. Ni Redis, ni mailer.
Terminado cuando: puedo crear una agencia por consola, loguearme en la web y ver el panel
vacío; pnpm test pasa incluido el de aislamiento.
```

## Fase 2 — El dominio puro

```text
Fase 2 de EditFlow. Leé docs/DOMINIO.md entero (incluidas las respuestas de §7) y, como
referencia de estilo, apps/api/_from-cori/REFERENCIA/order-state.js y promos.js.

En packages/shared, SIN tocar la API ni la web:
1. domain/video-state.ts: estados, VIDEO_TRANSITIONS, VIDEO_STATUS_LABEL (el único lugar
   con nombres visibles), canTransition() y blockers() según DOMINIO.md §2.
2. domain/batch-status.ts: deriveBatchStatus(videos) y batchProgress(videos) (§3).
3. domain/pricing.ts: quoteBatch({ unitPrice, quantity, tiers, manualDiscountPct? }) (§4).
   Plata en pesos enteros; redondeo una sola vez sobre el total.
4. schemas/: client, service (+ tiers), batch, video — Zod, con los tipos inferidos en types/.
5. Tests unitarios (vitest) de los tres módulos de domain/: cada transición válida e
   inválida, cada blocker, los bordes del escalón (cantidad justo en minQty, debajo, encima).

Funciones puras: nada de Prisma, Express, React ni Date.now() implícito (el "ahora" entra
por parámetro).
Terminado cuando: cobertura de domain/ al 100 % de ramas y pnpm typecheck pasa.
```

## Fase 3 — Clientes

```text
Fase 3 de EditFlow: el módulo Clientes, de punta a punta. Leé CLAUDE.md,
docs/cori/PATRON_DE_MODULO.md y DOMINIO.md §1 y §5.

API (src/modules/clients/): CRUD con los schemas de packages/shared. El listado trae, en una
sola query, para cada cliente: su editor responsable y su tanda activa con progreso (si no
hay tandas todavía, null). Un EDITOR solo ve los clientes de los que es responsable o tiene
algún video. Archivar, nunca borrar.

Web (components/dashboard/pages/clients/, el patrón de módulo de Cori):
- Página: DataTable con nombre, plan activo (sí/no + barra de progreso), editor, próximo
  vencimiento. SearchInput y Segmented por estado (activos/pausados/archivados).
- Riel: PanelCommandCard (nombre + estado), PanelSection "Plan activo" arriba de todo,
  "Contacto" (con link de WhatsApp: lib/phone), "Historial de tandas".
- Formularios en FormSection dentro del riel, con react-hook-form + el schema compartido.

Reusá los componentes copiados; si falta uno genérico, se crea en components/shared y se
anota. Antes de crear un componente, buscá si existe.
Terminado cuando: alta, edición y archivo funcionan desde la web; tests de la API pasan,
incluido el caso EDITOR.
```

## Fase 4 — Servicios y precios

```text
Fase 4 de EditFlow: la lista de precios. Leé DOMINIO.md §4.

API: CRUD de Service con sus PriceTier (validar: minQty únicos y crecientes, descuentos
crecientes, como validateTiers en REFERENCIA/promos.js). Endpoint POST /services/:id/quote
{ quantity } que devuelve quoteBatch() — el mismo cálculo que va a usar la tanda.
Web: página Servicios; en el riel, el editor de escalones y una vista previa "4 videos →
$X (−10 %)" que llama a quoteBatch() del paquete compartido, sin ir a la API.
Solo OWNER/ADMIN ven y editan precios.
Terminado cuando: el precio que muestra la web y el que devuelve /quote son iguales en los
tests para los bordes de cada escalón.
```

## Fase 5 — Tandas y videos

```text
Fase 5 de EditFlow: el núcleo. Leé DOMINIO.md §1–§4.

API:
- POST /clients/:id/batches { serviceId, quantity, kind, dueAt?, manualDiscountPct? }:
  recalcula el precio con quoteBatch() (nunca confía en un total del cliente), guarda el
  snapshot y crea los N videos en PENDIENTE_MATERIAL, todo en una transacción.
- PATCH /videos/:id: título, editor, links (rawUrl, draftUrl, finalUrl), dueAt.
- POST /videos/:id/transitions { to, note? }: usa canTransition(); si falla responde 409
  con el code y los blockers. Escribe VideoEvent y recalcula el estado de la tanda en la
  misma transacción.
- GET /videos (tablero) con filtros por estado, editor, cliente; un EDITOR ve solo los suyos.

Web:
- Tanda (desde el riel del cliente): sus videos en ListRow con StatusDot, editor y links;
  acciones de transición que muestran los blockers antes de intentar.
- Página Videos: tablero por columnas de estado.
Terminado cuando: el recorrido completo (crear tanda de 4 → material → edición → revisión →
cambios → aprobado → entregado) funciona desde la web y tiene un test de integración.
```

## Fase 6 — Editores y dashboard

```text
Fase 6 de EditFlow. Leé DOMINIO.md §5 y, como molde, los módulos couriers/ y dispatch/ y
stats/ del admin de Cori (pedime los archivos si no están en este repo).

API: GET /dashboard (clientes activos, tandas en curso, videos por estado, vencimientos de
la semana) y GET /editors/workload (por editor: clientes responsables, clientes con videos
en curso, videos en edición, en revisión, entregados en el mes). groupBy, sin N+1.
Web: Dashboard con stat cards; página Editores con una card por editor (el CourierCard de
Cori es el molde) y su carga; desde la card, sus clientes y videos.
Terminado cuando: los números del dashboard coinciden con un test que arma un escenario
conocido de dos editores y tres clientes.
```

---

## Después de la v1

En el orden en que suelen pedirse: registro de pagos por tanda · link público para que el
cliente vea su tanda (el seguimiento sin cuenta de Cori es el molde) · avisos por WhatsApp ·
tandas mensuales que se renuevan solas · exportar a Excel (`helpers/xlsx.js` ya copiado).
