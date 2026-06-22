# Servicio de Sugerencias de Contenido

Genera, por tenant, sugerencias de publicaciones para redes sociales a partir del
catálogo y las ventas de la tienda. Cada sugerencia combina:

1. **Selección (Fase 1)** — qué producto destacar y bajo qué "ángulo" (motivo),
   usando reglas puras sobre stock, novedad y ventas. Sin LLM.
2. **Generación (Fase 2)** — `copy` + `hashtags` redactados por un LLM a partir
   del producto y el ángulo, con *fallback* por template si el LLM falla.

Todo es multi-tenant: cada operación se acota por `tenantId` y los endpoints
requieren rol `ADMIN` o `STAFF`.

---

## Mapa de archivos

| Archivo | Responsabilidad |
|---|---|
| [index.js](index.js) | Modelo del servicio (`ContentSuggestionModel`): orquesta cache → DB → selección → LLM → persistencia. |
| [selection.js](selection.js) | Fase 1: elige producto + ángulo del día y lista ángulos aplicables a un producto. |
| [angles.js](angles.js) | Predicados y selectores puros por ángulo (única fuente de verdad). |
| [queries.js](queries.js) | Carga de datos (órdenes COMPLETED, catálogo, última sugerencia) para Fase 1. |
| [cost-guard.js](cost-guard.js) | Guarda de costo: tope diario de llamadas reales al LLM por tenant (Redis). |
| [../../lib/llm/](../../lib/llm/) | Fachada LLM, prompt, parseo y fallback (Fase 2). |

Capas que lo rodean:

- Rutas: [routes/content-suggestions.js](../../routes/content-suggestions.js) (montado en `/content-suggestions`)
- Controlador: [controllers/content-suggestions.js](../../controllers/content-suggestions.js)
- Validación: [schemas/content-suggestion.schema.js](../../schemas/content-suggestion.schema.js)
- Modelo de datos: `ContentSuggestion` en [prisma/schema.prisma](../../prisma/schema.prisma)

---

## Modelo de datos

`ContentSuggestion` (Prisma):

| Campo | Tipo | Notas |
|---|---|---|
| `angle` | `SuggestionAngle` | `BEST_SELLER` \| `NEW_ARRIVAL` \| `LOW_STOCK` \| `NO_RECENT_SALES` |
| `status` | `SuggestionStatus` | `SUGGESTED` (default) \| `USED` \| `DISMISSED` |
| `source` | `SuggestionSource` | `AUTO` (sugerencia del día) \| `MANUAL` (generada desde el tab de producto) |
| `date` | `Date` | Día (sin hora) al que pertenece la sugerencia. |
| `copy`, `hashtags`, `model`, `generatedAt` | nullables | Resultado de la Fase 2. `model = null` cuando se usó el fallback. |

**Identidad natural:** `@@unique([tenantId, date, productId, angle])`. Esto dedupe
tanto la sugerencia automática del día como las generaciones manuales, y permite
re-leer ante carreras (`P2002`).

---

## Fase 1 — Selección del producto y ángulo

### Ángulos

Definidos en orden de rotación ([angles.js](angles.js)):

```
BEST_SELLER → NEW_ARRIVAL → LOW_STOCK → NO_RECENT_SALES
```

Cada ángulo tiene un **predicado** (¿aplica a este producto?) y un **selector**
(¿cuál es el mejor candidato?). Los predicados son la única fuente de verdad,
compartida entre la selección del día y el tab de producto.

| Ángulo | Aplica cuando | Selector elige |
|---|---|---|
| `BEST_SELLER` | activo y con unidades vendidas en la ventana | el de más unidades vendidas |
| `NEW_ARRIVAL` | activo y creado dentro de los últimos 30 días | el `createdAt` más reciente |
| `LOW_STOCK` | activo y `0 < stock ≤ 5` (suma de variantes activas) | el de más ventas (desempate) |
| `NO_RECENT_SALES` | activo, con stock disponible y `0` ventas en la ventana | el primero del catálogo |

Constantes: `LOW_STOCK_THRESHOLD = 5`, `NEW_ARRIVAL_DAYS = 30`, ventana de ventas
`WINDOW_DAYS = 30` (en [selection.js](selection.js)).

### Datos de entrada

[queries.js](queries.js) carga en paralelo, acotado por tenant:

- **`completedOrders`**: órdenes `COMPLETED` dentro de la ventana, con la cadena
  `orderItems → variant → productId` para sumar unidades vendidas por producto.
- **`products`**: catálogo con `createdAt` y stock de variantes activas.
- **`lastSuggestion`**: la última sugerencia (por `date desc`) para saber por dónde
  rotar.

### Rotación

`selectProduct` arranca en el ángulo **siguiente** al último usado y recorre
`ANGLE_ORDER` circularmente; gana el primer ángulo que tenga candidato (fallback
automático). Si ninguno tiene candidato, lanza `422 NO_SUGGESTION_CANDIDATE`.

`anglesForProduct` reusa los predicados para devolver, en orden, los ángulos que
aplican a un producto puntual (para los chips del tab). Lanza `404` si el producto
no es del tenant.

---

## Fase 2 — Generación del copy (LLM)

Fachada en [../../lib/llm/index.js](../../lib/llm/index.js):

```
generateCopy({ product, angle, config }) -> { copy, hashtags, model }
```

- **Provider** seleccionable por env `LLM_PROVIDER` (`gemini` por defecto, o
  `anthropic`). Modelos por defecto: `gemini-2.5-flash` / `claude-haiku-4-5`.
- **Prompt** ([prompt.js](../../lib/llm/prompt.js)): system + user provider-agnósticos.
  Incluye la config de marca del tenant (nombre, lema, descripción, moneda) y el
  *brief* del ángulo redactado como **dato** (no como orden), para que el modelo no
  "repita la consigna" en el texto. Pide JSON estricto `{ copy, hashtags }`.
- **Parseo robusto** ([parse.js](../../lib/llm/parse.js)): quita fences ```` ```json ````,
  recorta al objeto JSON, valida la forma y normaliza hashtags (máx. 6).
- **Best-effort: NUNCA lanza.** Si el provider falla, no hay API key, o el JSON es
  inválido, devuelve un **fallback por template** ([fallback.js](../../lib/llm/fallback.js))
  con `model: null`. Así la sugerencia siempre se puede persistir.

### Refinamiento

`refineCopy(...)` reusa `generateCopy` con un bloque de refinamiento para producir
una variación de un copy ya existente (`shorter` / `informal` / `salesy` / `custom`
con instrucción libre). En refinamiento, el fallback es devolver el copy previo
intacto. **No persiste**: es una exploración efímera que el front decide si usa.

---

## Guarda de costo

[cost-guard.js](cost-guard.js) — `consumeLlmQuota({ tenantId, now })`:

- Contador diario en Redis (`INCR` + `EXPIRE` al fin del día UTC).
- Tope `DAILY_LLM_LIMIT = 15` por tenant/día. Al superarlo lanza `429 LLM_DAILY_LIMIT`.
- **Best-effort:** si Redis no está disponible, degrada a "sin límite" (no bloquea
  la feature).
- **Solo se llama cuando efectivamente se va a invocar el LLM.** Un hit de cache o
  de DB **no** consume cuota. Por eso `getToday` (sugerencia automática) no pasa por
  la guarda, pero `generateForProduct` y `refineProductCopy` (acciones manuales) sí.

---

## Cache (Redis)

Dos claves namespaced por tenant ([index.js](index.js)), TTL 6 h:

- `…:content-suggestion:<YYYY-MM-DD>` — sugerencia automática del día (`getToday`).
- `…:content-copy:<YYYY-MM-DD>:<productId>:<angle>` — copy on-demand por
  producto/ángulo (`generateForProduct`).

El cache solo evita relecturas y regeneraciones dentro del día; el `@@unique` de la
DB es el dedupe real. El timeline (`getRange`) **no** cachea, para reflejar al toque
cambios de status y regeneraciones.

---

## API

Base: `/content-suggestions`. Todos los endpoints requieren `verifyToken` + rol
`ADMIN` o `STAFF`.

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/today` | Sugerencia automática del día; se crea on-demand si no existe. |
| `GET` | `/?range=7\|15\|30` | Timeline de los últimos N días (default 7); días sin sugerencia vienen con `suggestion: null`. |
| `GET` | `/products/:productId/angles` | Ángulos que aplican a un producto. |
| `POST` | `/products/:productId/generate` | Genera (o sirve cacheado) el copy de un producto + ángulo. Body: `{ angle }`. `source: MANUAL`. |
| `POST` | `/refine` | Variación efímera de un copy. Body: `{ productId, angle, mode, instruction?, baseCopy, baseHashtags? }`. No persiste. |

### Flujo de `getToday`

```
cache hit?  ──sí─→ devuelve
   │ no
   ▼
fila AUTO del día en DB?  ──sí─→ cachea y devuelve
   │ no
   ▼
selectProduct (Fase 1) → loadProductForPrompt → loadBrandConfig
   ▼
generateCopy (Fase 2, best-effort)
   ▼
create(source: AUTO)  ──P2002 (carrera)─→ re-lee la AUTO del día
   ▼
cachea y devuelve
```

### Flujo de `generateForProduct`

```
cache hit? → fila (unique) en DB? → valida que el ángulo aplique (422 si no)
   → consumeLlmQuota (429 si excede) → generateCopy → create(source: MANUAL)
   → cachea y devuelve
```

---

## Errores

| Código | HTTP | Origen |
|---|---|---|
| `NO_SUGGESTION_CANDIDATE` | 422 | Ningún ángulo tiene candidato (catálogo vacío/inactivo). |
| `PRODUCT_NOT_FOUND` | 404 | El producto no pertenece al tenant. |
| `ANGLE_NOT_APPLICABLE` | 422 | El ángulo pedido no aplica al producto. |
| `LLM_DAILY_LIMIT` | 429 | Tope diario de generaciones LLM alcanzado. |

> El LLM en sí nunca propaga errores: degrada a fallback por template.
