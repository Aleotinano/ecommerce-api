---
tags: [servicio, dominio/contenido]
estado: en-desarrollo
ultima-revision: 2026-06-20
---

# Sugerencias de contenido

## Propósito
Cada día le propone al admin **una** publicación lista para redes sociales (copy + hashtags) sobre un
producto de su catálogo, elegido automáticamente según un "ángulo" (más vendido, novedad, stock bajo,
sin ventas). Además permite, desde el tab de un producto, generar el copy para un ángulo puntual y
pedir variaciones efímeras. El texto lo redacta un LLM provider-agnóstico ([[Cliente LLM]]).

## Modelo de datos
Fuente: `prisma/schema.prisma` (modelo `ContentSuggestion` + enums).

- **`ContentSuggestion`** — `tenantId`, `productId`, `angle` (`SuggestionAngle`), `status`
  (`SuggestionStatus`, default `SUGGESTED`), `source` (`SuggestionSource`, default `AUTO`), `date`
  (`@db.Date`, día sin hora), y los campos de IA: `copy`, `hashtags[]`, `model`, `generatedAt`.
- **Unique compuesto `(tenantId, date, productId, angle)`** — dedupe natural: una sola fila por
  tenant + día + producto + ángulo. Sirve tanto a la sugerencia automática del día como a las
  generaciones manuales ([prisma/schema.prisma:255-257](prisma/schema.prisma#L255-L257)).
- **Enums:** `SuggestionAngle` = `BEST_SELLER | NEW_ARRIVAL | LOW_STOCK | NO_RECENT_SALES`;
  `SuggestionStatus` = `SUGGESTED | USED | DISMISSED`; `SuggestionSource` = `AUTO | MANUAL`.

Scoping por `tenantId` en todas las queries (`services/content-suggestions/*`); el `tenantId` viene
de `req.tenantId`, nunca del cliente. Ver [[Multi-tenancy]].

## Reglas de negocio / invariantes

- **Modelo push: una sugerencia automática por día.** `getToday` busca primero la fila
  `(tenantId, date, source: AUTO)`; si existe la devuelve, si no selecciona producto + ángulo, genera
  y persiste con `source: AUTO` ([services/content-suggestions/index.js:86-156](services/content-suggestions/index.js#L86-L156)).
  La unicidad efectiva del día se apoya en: (1) el `findFirst` previo, (2) que `selectProduct` es
  **determinista** dado el mismo estado, y (3) el unique compuesto, que ante una carrera (`P2002`)
  hace re-leer la existente en vez de duplicar.
- **La selección rota los ángulos.** Arranca en el siguiente ángulo al último usado
  (`ANGLE_ORDER`, cualquier `source`, por `date` desc) y toma el **primer ángulo con candidato**; si
  ninguno aplica, lanza `NO_SUGGESTION_CANDIDATE` (422)
  ([services/content-suggestions/selection.js:42-73](services/content-suggestions/selection.js#L42-L73)).
- **Una sola fuente de verdad para "qué ángulo aplica".** `ANGLE_PREDICATES` decide elegibilidad y se
  reusa en dos lugares: la selección del día y el tab de producto (`anglesForProduct`). Reglas:
  `BEST_SELLER` = activo y con ventas; `NEW_ARRIVAL` = activo y creado dentro de 30 días;
  `LOW_STOCK` = activo y stock agregado entre 1 y 5; `NO_RECENT_SALES` = activo, sin ventas en la
  ventana y con stock disponible ([services/content-suggestions/angles.js:52-59](services/content-suggestions/angles.js#L52-L59)).
- **Ventana de ventas = 30 días, sobre órdenes `COMPLETED`.** `loadSelectionData` suma unidades
  recorriendo `orderItems → variant → product` solo de órdenes completadas
  ([services/content-suggestions/queries.js:10-48](services/content-suggestions/queries.js#L10-L48)).
  Acopla esta feature al estado `COMPLETED` de [[Órdenes]] y reusa utilidades de [[Estadísticas]]
  (`startOfDay`, `addDays`).
- **Generar manual valida el ángulo antes de gastar LLM.** `generateForProduct` rechaza con
  `ANGLE_NOT_APPLICABLE` (422) si el ángulo no aplica al producto, **antes** de consumir cuota
  ([services/content-suggestions/index.js:193-205](services/content-suggestions/index.js#L193-L205)).
- **La generación nunca rompe la feature.** `generateCopy` es best-effort: si el LLM falla, no hay API
  key o el JSON es inválido, devuelve un copy de fallback por template con `model: null`, y la
  sugerencia se persiste igual ([lib/llm/index.js:26-60](lib/llm/index.js#L26-L60)). Ver [[Cliente LLM]].

### Reglas del system prompt
Fuente: `lib/llm/prompt.js:buildPrompt`
([lib/llm/prompt.js:38-62](lib/llm/prompt.js#L38-L62)).

- Rol: *community manager* de la tienda (usa `storeName`, `storeTagline`, `storeDescription` de
  [[TenantConfig]]). Idioma: **español rioplatense (es-AR)**, cercano, sin sonar a publicidad robótica.
- Tarea: **UNA** publicación breve para redes sobre el producto indicado.
- El **ángulo define el tono**, no se menciona literalmente ni se convierte en hashtag. Los
  `ANGLE_BRIEFS` se pasan como **dato** ("Es el producto más elegido…"), no como orden, para que el
  modelo no los repita como instrucción.
- **Prohibido describir la estrategia** ("genera deseo", "usa prueba social", "destaca que es el más
  vendido"): eso es la consigna, no el caption. El prompt incluye un ejemplo MAL/BIEN para calibrar.
- **Salida: JSON estricto** `{ copy, hashtags }`, sin markdown ni fences. `copy` ≤ 280 chars, 1–3
  frases, máx. 1 emoji, sin hashtags adentro. `hashtags`: 3–6, términos que un comprador **realmente
  busca** (tipo de prenda, estilo, ocasión, ubicación), **nunca** del motivo interno
  (`#MasVendido`, `#StockBajo`, etc.).
- **Refinamiento:** mantiene el mismo `system` y solo extiende el `user` con el copy previo + la
  consigna (`shorter` / `informal` / `salesy` o instrucción libre `custom`)
  ([lib/llm/prompt.js:71-86](lib/llm/prompt.js#L71-L86)).

### Qué se persiste vs. qué es efímero

| Operación | Persiste | `source` | Consume cuota LLM |
| --- | --- | --- | --- |
| `getToday` (push diario) | **Sí** | `AUTO` | **No** (ver deuda técnica) |
| `generateForProduct` (tab producto) | **Sí** | `MANUAL` | Sí |
| `refineProductCopy` (variación) | **No — efímero** | — | Sí |
| `getProductAngles` / `getRange` | No escribe | — | No |

`refineProductCopy` devuelve la variación sin guardarla: es una exploración que el front decide si usa
([services/content-suggestions/index.js:250-275](services/content-suggestions/index.js#L250-L275)).

## Máquina de estados
`SuggestionStatus` (`SUGGESTED | USED | DISMISSED`) existe en el modelo, **pero ningún endpoint del
servicio transiciona el estado**: toda sugerencia se crea y queda en `SUGGESTED` (default). No hay
máquina de estados implementada hoy. *(Ver Preguntas abiertas.)*

## Cache y guarda de costo

- **Cache Redis, degrada abierto.** `getToday` cachea la sugerencia del día (TTL 6 h) y
  `generateForProduct` cachea el copy por `(tenant, día, producto, ángulo)`. El cache solo evita
  relecturas/regeneraciones; el unique de DB ya dedupe. `getRange` **no** cachea (refleja al toque
  cambios). Ver [[Redis y cache]].
- **Cost-guard por tenant/día, degrada abierto.** `consumeLlmQuota` incrementa un contador en Redis
  (`DAILY_LLM_LIMIT = 15`) y lanza `429 LLM_DAILY_LIMIT` al superarlo. Si Redis no está, **deja pasar**
  (best-effort, no bloquea la feature de admin)
  ([services/content-suggestions/cost-guard.js](services/content-suggestions/cost-guard.js)).
  > [!note] Esta guarda degrada **abierto** porque es una feature de admin de bajo volumen. Contrastar
  > con el cost-guard **fail-closed** del chatbot público en [[Chat de tienda]].

## Endpoints
`routes/content-suggestions.js` (montado en `/content-suggestions`). Todos: `verifyToken` +
`requireRole(["ADMIN","STAFF"])`.

| Método | Ruta | Qué hace | Auth / rol |
| --- | --- | --- | --- |
| GET | `/` | Timeline de los últimos `range` (7/15/30, default 7) días, con `null` en días sin sugerencia | `ADMIN` / `STAFF` |
| GET | `/today` | Sugerencia del día (se crea on-demand si no existe) | `ADMIN` / `STAFF` |
| GET | `/products/:productId/angles` | Ángulos que aplican a un producto | `ADMIN` / `STAFF` |
| POST | `/products/:productId/generate` | Genera (o sirve cacheado) el copy para un ángulo | `ADMIN` / `STAFF` |
| POST | `/refine` | Variación efímera de un copy ya generado | `ADMIN` / `STAFF` |

Validación: `schemas/content-suggestion.schema.js` (`generateBody`, `refineBody`,
`suggestionRangeQuery`). `refine` con `mode: "custom"` exige `instruction`.

## Dependencias
- [[Cliente LLM]] — `generateCopy` / `refineCopy` (provider-agnóstico, fallback por template).
- [[Redis y cache]] — cache de sugerencias/copy y contador del cost-guard.
- [[TenantConfig]] — config de marca que alimenta el system prompt (`loadBrandConfig`).
- [[Productos]] / [[Variantes]] — catálogo y stock para selección y prompt.
- [[Órdenes]] — ventas `COMPLETED` para los ángulos de ventas.
- [[Estadísticas]] — reusa `startOfDay` / `addDays` y la ventana de 30 días.

## Integraciones externas
- LLM vía [[Cliente LLM]]: provider por env `LLM_PROVIDER` (`anthropic` | `gemini`; default `gemini`).
  El "modo mock" efectivo es el **fallback por template** cuando no hay API key o el proveedor falla
  (`lib/llm/fallback.js`, `lib/llm/index.js`).

## Deuda técnica / cosas raras
Etiquetas por tipo de acción — ver convención en [[App]].

- `[comentario-miente]` **El comentario del unique contradice el schema.** `index.js` dice *"El unique
  (tenantId, date) asegura una sola por dia"*
  ([services/content-suggestions/index.js:83-84](services/content-suggestions/index.js#L83-L84)), pero
  el unique real es el compuesto de 4 campos `(tenantId, date, productId, angle)`. La unicidad "una
  AUTO por día" la garantiza la lógica (`findFirst` + `selectProduct` determinista), no esa
  constraint. El código funciona; el comentario miente. Acción = corregir el comentario (trivial).
- `[riesgo]` **El push diario (`getToday`) no consume cost-guard.** Solo `generateForProduct` y
  `refineProductCopy` llaman a `consumeLlmQuota`; la generación automática puede invocar al LLM sin
  descontar cuota. No es incorrecto hoy, pero deja un hueco de gasto. Acción = contar (o presupuestar
  aparte) el push.
- `[código-muerto]` **`status` (`SUGGESTED/USED/DISMISSED`) nunca transiciona.** Ningún flujo lo mueve;
  `toTimelineSuggestion` lo expone pero siempre vale `SUGGESTED`. Acción = decidir **quitar** o
  **cablear** (decisión en "Preguntas abiertas"; candidato directo a quitar).
- `[riesgo]` **Ventana de ventas atada a `createdAt` de la orden**, no a la fecha de completado:
  `loadSelectionData` filtra `status: COMPLETED` pero acota por `createdAt`
  ([services/content-suggestions/queries.js:12-26](services/content-suggestions/queries.js#L12-L26)).
  Una orden creada fuera de la ventana pero completada dentro no cuenta. Acción = decidir el eje
  temporal correcto.

## Preguntas abiertas / mejoras candidatas
- ¿Agregar endpoints para marcar una sugerencia como `USED` / `DISMISSED` y darle sentido al enum
  `SuggestionStatus`?
- ¿El push diario debería contar contra el cost-guard (o tener su propio presupuesto)?
- ¿Corregir el comentario del unique para que no contradiga el schema?
- ¿La ventana de ventas debería medirse por fecha de **completado** en vez de `createdAt`?
- ¿Persistir las variaciones de `refine` que el usuario efectivamente elige?
