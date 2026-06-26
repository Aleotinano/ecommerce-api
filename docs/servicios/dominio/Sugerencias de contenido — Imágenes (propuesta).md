---
tags: [servicio, dominio/contenido, propuesta]
estado: propuesta
ultima-revision: 2026-06-25
---

# Sugerencias de contenido — Imágenes (propuesta)

> [!note] Esto es un documento de **diseño**, no de código
> El servicio en producción está descrito en [[Sugerencias de contenido]] (la fuente de verdad sigue
> siendo el código). Este doc captura la **visión objetivo** y el plan para reorientar la feature
> hacia la **imagen publicitaria generada** como entregable principal. Mientras no haya código, todo
> lo de acá es propuesta: cada bloque de "código futuro" cita la ruta donde *irá*, no lo que hay hoy.

## Propósito / problema

Una tienda chica necesita publicidad para vender, pero **cada imagen publicitaria cuesta**: hay que
contratar a un diseñador, esperar, iterar y pagar por pieza. Eso frena la cadencia de publicación.

La propuesta resuelve el problema de raíz: **generar la imagen publicitaria con IA** a partir de la
**foto real del producto** (image-to-image), entregando un **post listo para publicar** —imagen +
copy + hashtags—. El admin elige qué quiere generar, ve opciones y se queda con la que más le gusta.

> [!info] Cambio de eje
> Hoy la feature **solo entrega texto** (`copy` + `hashtags`) y muestra la foto cruda del producto.
> En la propuesta el **núcleo pasa a ser la imagen generada**; el copy y los hashtags quedan como
> **complementos** del post, no como el producto principal (ver [[#Reposicionamiento de copy + hashtags]]).

## Cambio de eje vs. hoy

| Aspecto | Hoy (texto-first) | Propuesta (imagen-first) |
| --- | --- | --- |
| Entregable principal | `copy` + `hashtags` | **Imagen publicitaria generada** |
| Imagen | Foto cruda del catálogo (`product.img`) | Imagen IA (image-to-image desde `product.img`) |
| Copy / hashtags | El producto | **Complemento** del post |
| Elección del usuario | Ángulo + refinar texto | Ángulo + **qué generar** + **elegir variante** |
| Salida del LLM | JSON `{ copy, hashtags }` (texto) | Imagen (bytes) + JSON de texto en paralelo |

**Qué se conserva tal cual** (no se reinventa nada que ya funcione):
- La **selección por ángulo** de Fase 1 — `selectProduct` / `anglesForProduct`
  ([services/content-suggestions/selection.js](services/content-suggestions/selection.js)) y los
  `ANGLE_PREDICATES` como fuente única de verdad ([services/content-suggestions/angles.js](services/content-suggestions/angles.js)).
- El **scoping multi-tenant** (`tenantId` de `req.tenantId`, ver [[Multi-tenancy]]).
- La **degradación best-effort**: igual que el cliente de texto nunca rompe la feature
  ([lib/llm/index.js](lib/llm/index.js)), el cliente de imagen tampoco debe romperla.
- El **cache Redis** y el patrón de **cost-guard** ([[Redis y cache]]), aunque la imagen sume su
  propia cuota (ver [[#Costo y cuotas]]).

## Flujo propuesto

1. **Producto + ángulo** — reusa la selección existente: el push diario sigue eligiendo producto +
   ángulo con `selectProduct`; el tab de producto sigue ofreciendo `anglesForProduct`. Sin cambios.
2. **El usuario elige qué generar** — toggles (ver [[#Qué se genera (opciones del usuario)]]): imagen
   publicitaria, info en pantalla, precio en pantalla.
3. **Builder de prompt de imagen** — compone el prompt óptimo a partir de producto + ángulo +
   branding del tenant + las opciones elegidas (ver [[#Optimización del prompt de imagen]]).
4. **Generación image-to-image** — el modelo de imagen recibe `product.img` como **referencia** y el
   prompt, y produce **3 variantes** (las 3 se persisten en Cloudinary + `SuggestionImage`).
5. **El usuario elige una variante** — galería de 3 opciones; el admin se queda con la que prefiere
   (`chosen=true`) y las otras 2 se limpian (Cloudinary + DB).
6. **Overlay de texto/precio** — si el usuario activó info/precio en pantalla, se aplican como overlay
   sobre la variante elegida (Cloudinary, ver [[#Qué se genera (opciones del usuario)]]); el asset base
   queda limpio y editable.
7. **Copy + hashtags en paralelo** — se generan como **complemento** del post con el cliente de texto
   actual (reposicionado, ver [[#Reposicionamiento de copy + hashtags]]).
8. **Entrega del asset** — descargar / copiar / compartir manual (como hoy con WhatsApp en
   `SuggestionPanelBody.tsx`). **Sin auto-publicar** a redes (decisión tomada).

> [!note] Solo bajo demanda
> La generación de imagen se dispara **únicamente desde el tab de producto**, cuando el admin la pide.
> El **push diario sigue siendo texto** (no genera imagen automáticamente) para acotar el gasto del
> modelo de imagen (decisión tomada).

## Qué se genera (opciones del usuario)

El admin elige **qué incluir** antes de generar; cada opción modula el prompt:

- **Imagen publicitaria** — la escena generada por IA con el producto.
- **Info en pantalla** — texto sobre la imagen (nombre, gancho corto, llamada a la acción).
- **Precio en pantalla** — el precio del producto renderizado sobre la imagen.

> [!check] Cómo renderizar texto y precio → **overlay post-generación** (decisión tomada)
> El modelo genera la imagen **limpia** y el texto/precio se superponen después con **transformaciones
> de Cloudinary** (overlays `l_text:`). Razones: texto **nítido** y precio **exacto** (los modelos
> image-to-image suelen escribir texto con errores), y el overlay es **editable sin regenerar** la
> imagen. Reusa [[Almacenamiento de imágenes]] y desacopla "qué dibuja el modelo" de "qué texto
> mostramos". El asset base en `SuggestionImage.imageUrl` queda sin texto; el overlay se compone al
> mostrar/descargar.

## Cliente de imagen (image-to-image)

El [[Cliente LLM]] actual es **solo texto**: `generate({ system, user })` en
[lib/llm/providers/gemini.js](lib/llm/providers/gemini.js) y
[lib/llm/providers/anthropic.js](lib/llm/providers/anthropic.js). La generación de imágenes es una
**capacidad distinta**:

- **Provider de imagen independiente del de texto.** `LLM_PROVIDER` puede ser `anthropic`, que **no
  genera imágenes**. La imagen necesita su propio selector — p. ej. `IMAGE_PROVIDER` y
  `GEMINI_IMAGE_MODEL` en [config.js](config.js) (la sección `DEFAULTS.LLM`), reusando
  `GEMINI_API_KEY`. Default a Gemini image (ej. Gemini 2.5 Flash Image) sin importar `LLM_PROVIDER`.
- **Interfaz propuesta:** `generateImage({ referenceImage, prompt, n }) -> { images: Buffer[], model }`,
  análoga a `generateCopy`. Vive junto al cliente de texto en `lib/llm/` (nuevo `lib/llm/image.js` +
  `lib/llm/providers/gemini-image.js`).
- **Best-effort, nunca rompe la feature.** Igual que el texto cae a fallback por template
  ([lib/llm/fallback.js](lib/llm/fallback.js)), la imagen debe **degradar a la foto real del
  producto** (`product.img`, sin overlay) si el modelo falla, no hay API key, o el provider no
  soporta imágenes. La sugerencia se entrega igual.
- **Persistencia vía Cloudinary.** La imagen generada se sube con `uploadImageToCloudinary`
  ([lib/imageManager.js](lib/imageManager.js)) usando un `entity` nuevo (ej. `content-suggestions`),
  y se guarda el `publicId` para poder borrarla — mismo patrón que `Product.imgPublicId`
  (ver [[Almacenamiento de imágenes]]).

## Optimización del prompt de imagen

La calidad del asset depende casi por completo del prompt. Igual que el prompt de texto vive aislado
en [lib/llm/prompt.js](lib/llm/prompt.js) (`buildPrompt`), la imagen necesita su **builder dedicado**
(`lib/llm/image-prompt.js`) que componga, a partir de datos estructurados, un prompt fuerte:

- **Branding del tenant** desde [[TenantConfig]] — `storeName`, `storeTagline`, `storeDescription`,
  `logoUrl` (no hay campo de paleta de colores hoy; la identidad cromática queda a criterio del
  modelo según el resto del branding).
- **Ángulo** como tono visual (urgencia, novedad, prueba social), no como texto literal — mismo
  criterio que `ANGLE_BRIEFS` en el prompt de texto.
- **Producto** — nombre, categoría, descripción para guiar la escena.
- **Opciones elegidas** por el usuario (composición, dónde va el texto/precio).

### Pipeline multi-etapa (dirección elegida)

La generación **no** llama directo al modelo de imagen: primero razona en **espacio de texto**
(barato y rápido) para construir el mejor prompt posible, y recién al final ejecuta la llamada de
imagen (cara). Etapas:

1. **Ver → describir** (vision-to-text) — un LLM multimodal mira `product.img` y la describe en texto:
   prenda, color, material, encuadre, fondo. Gemini y Claude soportan visión, así que reusa el
   cliente de texto/multimodal actual. Desacopla "qué hay en la foto" del resto del prompt.
2. **Enriquecer** — a esa descripción base se le suman especificaciones estructuradas: datos del
   producto, branding del tenant ([[TenantConfig]]), el ángulo, y las opciones elegidas por el usuario.
3. **Skill de diseñador** — un paso LLM con persona/skill de *director de arte* que **toma las
   decisiones de diseño** (composición, paleta, luz, estilo según el ángulo, dónde ubicar texto/precio)
   y emite el **prompt de imagen final optimizado**. Acá vive la idea de "pasar skills y herramientas":
   el skill es un módulo de prompt reutilizable, no lógica hardcodeada.
4. **Generar** — el modelo image-to-image recibe el prompt afinado **+ `product.img` como referencia**
   y produce las N variantes.

> [!warning] Costo y latencia del pipeline
> Cada etapa 1–3 es una llamada de **texto** (barata/rápida) que precede a la llamada de **imagen**
> (cara). El beneficio es control y calidad; el costo es latencia y algo más de gasto de texto. El
> cost-guard debe contar **por separado** el texto del pipeline y la imagen (ver [[#Costo y cuotas]]).
> Las etapas son opcionales/colapsables: en un MVP se puede arrancar con 1 sola etapa (builder
> estático) y sumar las demás después sin cambiar el contrato de `generateImage`.

## Reposicionamiento de copy + hashtags

Hoy el copy y los hashtags son el entregable. En la propuesta acompañan a la imagen, pero el usuario
señaló dos debilidades a corregir (ajustes al system prompt de [lib/llm/prompt.js](lib/llm/prompt.js)):

- **Descripciones que resuelvan, no que describan.** El copy actual es correcto pero "plano":
  facilita la tarea pero no resuelve un problema. Objetivo: copys con gancho/beneficio concreto, no
  una mera descripción del producto.
- **Hashtags cazadores, no informativos.** Hoy ya se pide que sean términos "que un comprador
  realmente busca" (no `#MasVendido`), pero en la práctica quedan informativos. Objetivo: hashtags
  orientados a **descubrimiento/SEO social** (intención de búsqueda, ocasión, ubicación), evaluados
  por su capacidad de atraer tráfico, no de describir.

El cliente de texto, el cost-guard de texto y el refinamiento efímero **se mantienen** como están.

## Modelo de datos propuesto

**Relación 1→N: modelo nuevo `SuggestionImage`** (decisión tomada). Cada generación produce **3
variantes** asociadas a una `ContentSuggestion`; el usuario elige una.

```
SuggestionImage {
  id          Int
  suggestionId Int      // FK a ContentSuggestion
  tenantId    Int       // scoping multi-tenant (ver [[Multi-tenancy]])
  imageUrl    String    // secure_url de Cloudinary
  imagePublicId String  // para poder borrar el asset
  options     Json      // toggles usados: { imagen, infoEnPantalla, precioEnPantalla }
  model       String?   // modelo de imagen usado (null si fallback)
  prompt      String    // prompt final que generó la variante (trazabilidad)
  chosen      Boolean   @default(false)
  createdAt   DateTime  @default(now())
}
```

La imagen vive en Cloudinary y se guarda su `publicId` para poder borrarla
([[Almacenamiento de imágenes]]). Las **3 variantes se persisten** al generar; cuando el usuario
elige una se marca `chosen=true` y **las otras se limpian** (Cloudinary + DB) para no acumular assets
huérfanos. El texto/precio en pantalla **no** se quema en el asset de Cloudinary base: se aplica como
overlay (ver [[#Qué se genera (opciones del usuario)]]), así editar el precio no obliga a regenerar.

El enum `SuggestionStatus` (`SUGGESTED/USED/DISMISSED`) se **cablea** en este rediseño (decisión
tomada): cierra la deuda de código muerto en [[Sugerencias de contenido]] y el front ya muestra esos
estados. Endpoints para transicionar a `USED` / `DISMISSED` (ver [[#Endpoints propuestos]]).

## Costo y cuotas

Generar imágenes es **bastante más caro** que generar texto. El cost-guard actual cuenta llamadas de
texto (`DAILY_LLM_LIMIT = 15`) en [services/content-suggestions/cost-guard.js](services/content-suggestions/cost-guard.js).
La propuesta agrega un **cost-guard propio de imagen** (decisión tomada):

- **Límite bajo:** `DAILY_IMAGE_LIMIT ≈ 10` **generaciones** por tenant/día (cada generación = 3
  variantes; el contador cuenta generaciones, no variantes sueltas).
- **Fail-closed:** a diferencia del cost-guard de texto (que degrada **abierto**), si Redis no
  responde el de imagen **bloquea** la generación. La imagen es la pieza más cara: ante incertidumbre,
  no gastar. Contraste explícito con el cost-guard de texto y con el del chatbot ([[Chat de tienda]]).
- **Contador Redis separado** del de texto, por tenant/día.
- El **texto del pipeline** (etapas ver→describir / enriquecer / skill de diseñador) cuenta contra el
  cost-guard de **texto**, no contra el de imagen: son llamadas de texto baratas (ver [[#Pipeline multi-etapa (dirección elegida)]]).

## Endpoints propuestos

Todos mantienen `verifyToken` + `requireRole(["ADMIN","STAFF"])` (igual que
[routes/content-suggestions.js](routes/content-suggestions.js)). Borrador:

| Método | Ruta | Qué hace |
| --- | --- | --- |
| POST | `/products/:productId/image` | Genera **3 variantes** de imagen para un producto + ángulo + opciones (consume cuota de imagen) |
| POST | `/suggestions/:id/image/choose` | Marca la variante elegida (`chosen=true`) y limpia las otras (Cloudinary + DB) |
| DELETE | `/suggestions/:id/image` | Borra el asset (Cloudinary + DB) |
| PATCH | `/suggestions/:id/status` | Transiciona `SuggestionStatus` a `USED` / `DISMISSED` |

Validación con Zod en `schemas/content-suggestion.schema.js` (extender con `imageOptions`, `angle`,
`status`).

## Impacto en frontend

En `apps/admin/components/dashboard/content-suggestions/`:
- **Selector de opciones** (imagen / info / precio) antes de generar.
- **Galería de variantes** para elegir una.
- Extender `panel/SuggestionPanelBody.tsx` (hoy edita copy + hashtags y descarga la foto cruda) para
  mostrar la imagen generada y los botones de descargar / copiar / compartir sobre el asset nuevo.

## Dependencias

- [[Almacenamiento de imágenes]] — subir/borrar el asset generado en Cloudinary (`publicId`).
- [[Cliente LLM]] — se extiende con el cliente de imagen (provider independiente); el texto sigue igual.
- [[TenantConfig]] — branding (`storeName`, `storeTagline`, `storeDescription`, `logoUrl`) que alimenta el prompt de imagen.
- [[Productos]] / [[Variantes]] — `product.img` como referencia image-to-image y datos para el prompt.
- [[Redis y cache]] — cache de assets y contador del cost-guard de imagen.
- [[Sugerencias de contenido]] — base sobre la que se construye (selección, ángulos, push diario).

## Integraciones externas

- **Modelo de imagen** (default Gemini 2.5 Flash Image vía `GEMINI_API_KEY`). Sin auto-publicar a
  redes: el alcance termina en **entregar el asset** (descargar/copiar/compartir manual).

## Decisiones tomadas

Cerradas con el usuario (2026-06-25):

| Decisión | Resolución |
| --- | --- |
| Cómo se genera la imagen | **IA generativa image-to-image** (foto real como referencia; default Gemini 2.5 Flash Image) |
| Publicación | **Solo genera el asset** — descargar/copiar/compartir manual, sin auto-publicar a redes |
| Pipeline de prompt | **Multi-etapa**: ver→describir → enriquecer → skill de diseñador → generar (colapsable a 1 etapa en el MVP) |
| Modelo de datos | **1→N**: modelo nuevo `SuggestionImage` (varias variantes por sugerencia) |
| Variantes por generación | **3** |
| Texto/precio en pantalla | **Overlay post-gen con Cloudinary** (`l_text:`), no lo dibuja el modelo |
| Alcance de generación | **Solo bajo demanda** en el tab de producto; el push diario sigue siendo texto |
| Cuota de imagen | `DAILY_IMAGE_LIMIT ≈ 10` generaciones/tenant/día, **fail-closed** (contador Redis aparte) |
| `SuggestionStatus` | Se **cablea** (`USED`/`DISMISSED`) en este rediseño |

## Quedan por afinar en implementación

- Valores finos: tamaño/posición exactos de los overlays, parámetros del modelo de imagen, TTL del
  cache de assets.
- Texto del **skill de diseñador** (el prompt-persona) y de los ajustes al system prompt de copy
  (resolver vs. describir, hashtags cazadores).
- Manejo de fallos parciales del pipeline (ej. la etapa de visión funciona pero la de imagen no).

## Plan de implementación por fases

1. **Cliente de imagen** — `lib/llm/image.js` + `providers/gemini-image.js`, config (`IMAGE_PROVIDER`,
   `GEMINI_IMAGE_MODEL`), best-effort con degradación a `product.img`.
2. **Modelo de datos + Cloudinary** — migración Prisma del modelo `SuggestionImage` (1→N) y
   subida/borrado vía [lib/imageManager.js](lib/imageManager.js) con `entity` nuevo (`content-suggestions`).
3. **Pipeline de prompt** — `lib/llm/image-prompt.js`: etapas ver→describir, enriquecer y skill de
   diseñador (branding + ángulo + opciones). Arrancar colapsado a 1 etapa, expandir después.
4. **Overlay de texto/precio** — transformaciones Cloudinary (`l_text:`) sobre la variante elegida.
5. **Endpoints + schemas** — generar (3 variantes) / elegir / borrar / status, con validación Zod.
6. **Cost-guard de imagen** — contador Redis separado, `DAILY_IMAGE_LIMIT ≈ 10`, **fail-closed**.
7. **Cablear `SuggestionStatus`** — transiciones `USED` / `DISMISSED`.
8. **Frontend** — selector de opciones, galería de 3 variantes, panel actualizado.
9. **Reposicionar copy/hashtags** — ajustes al system prompt de texto (resolver vs. describir,
   hashtags cazadores).
