---
tags: [servicio, dominio/contenido, propuesta]
estado: librería lista, feature no expuesta
ultima-revision: 2026-07-22
lado: backend
---

# Sugerencias de contenido — Imágenes (propuesta)

> [!warning] Ya NO es "solo diseño" — una porción sustancial ya está implementada y testeada
> Esta nota reemplaza la versión anterior ("mientras no haya código, todo es propuesta"), que quedó
> desactualizada: el **cliente de imagen, el pipeline multi-etapa de prompt, el modelo de datos
> `SuggestionImage` y la capa de persistencia en Cloudinary ya existen en el repo y tienen tests
> unitarios** (`tests/image-prompt.test.js`, `tests/llm-image.test.js`,
> `tests/content-suggestions-images.test.js`). Lo que **falta** es exponerlo: no hay ningún endpoint
> HTTP, controller, cost-guard de imagen, ni el cableado de `SuggestionStatus` — son piezas sueltas
> sin orquestador de negocio. Cada sección de abajo dice explícitamente qué ya existe (con ruta real)
> y qué sigue siendo solo propuesta.

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

> [!note] Ya implementado
> El [[Cliente LLM]] de texto (`generate({ system, user })` en
> [lib/llm/providers/gemini.js](lib/llm/providers/gemini.js) y
> [lib/llm/providers/anthropic.js](lib/llm/providers/anthropic.js)) sigue siendo solo texto, pero la
> generación de imágenes ya vive como capacidad propia, no como propuesta:

- **Provider de imagen independiente del de texto**, ya cableado: `config.js` (`DEFAULTS.LLM.IMAGE.PROVIDER`,
  `DEFAULTS.LLM.IMAGE.GEMINI_MODEL`) y `schemas/env.schema.js` (`IMAGE_PROVIDER` — enum, default
  `"gemini"` — y `GEMINI_IMAGE_MODEL`, default `"gemini-2.5-flash-image"`) — el default que este doc
  proponía ya es la config real.
- **`lib/llm/image.js`** (`generateImages`) — fachada provider-agnóstica, `Promise.allSettled`,
  degrada a `{ images: [], model: null }` si el provider falla o no hay API key (mismo patrón
  best-effort del cliente de texto, nunca rompe la feature).
- **`lib/llm/providers/gemini-image.js`** (`geminiImageProvider.generateImage`) — llama a
  `generateContent` de Gemini con `responseModalities: ["IMAGE"]`.
- **Persistencia vía Cloudinary — ya implementada**: `lib/imageManager.js` tiene
  `uploadBase64ToCloudinary` (subida desde base64/data-URI, distinta de `uploadImageToCloudinary` que
  sube desde un path de disco/multer) — es exactamente la pieza que este doc pedía para subir
  imágenes generadas por IA sin pasar por disco.
- **Lo que falta**: nada invoca `generateImages` desde ningún flujo de negocio real — no hay
  controller ni endpoint que lo dispare (ver "Endpoints propuestos" abajo). Es una librería lista,
  sin quien la llame.

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

### Pipeline multi-etapa (dirección elegida) — ya implementado en `lib/llm/image-prompt.js`

> [!note] Ya implementado
> Las tres etapas de abajo ya están cableadas en `lib/llm/image-prompt.js`: `buildImagePrompt`
> (builder determinístico), `describeImage` (etapa ver→describir, usa `textProvider().generate({
> images: [...] })`) y `designImagePrompt`/`composeImagePrompt` (etapa "skill de diseñador"). No están
> "colapsadas a 1 etapa" como sugería el plan de MVP — las tres ya corren, con degradación
> best-effort en cada paso.

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

## Modelo de datos — ya implementado

> [!note] Ya en el schema real, no propuesto
> El modelo de abajo **ya existe** en `prisma/schema.prisma:487-509`, con migración aplicada, más
> las relaciones inversas `ContentSuggestion.images` (`schema.prisma:456`) y
> `Tenant.suggestionImages` (`schema.prisma:28`). La capa de persistencia también existe:
> `services/content-suggestions/images.js` (132 líneas) tiene `persistVariants` (sube a Cloudinary
> vía `uploadBase64ToCloudinary` y crea las filas en transacción), `chooseVariant` (marca
> `chosen=true` y borra las otras variantes en Cloudinary + DB) y `deleteVariant`.

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
overlay (ver [[#Qué se genera (opciones del usuario)]] — el overlay en sí sigue siendo propuesta, no
confirmé código para esa parte), así editar el precio no obliga a regenerar.

**Lo que sigue sin existir**: el enum `SuggestionStatus` (`SUGGESTED/USED/DISMISSED`) sigue sin
cablearse — no hay ningún endpoint ni código que setee `USED`/`DISMISSED` en ningún lado del repo
(sigue siendo código muerto, ver [[Sugerencias de contenido]]). `schemas/content-suggestion.schema.js`
tampoco tiene nada de imagen todavía (`imageOptions`, `angle` extendido, `status`).

## Costo y cuotas — sigue siendo propuesta, no implementado

Generar imágenes es **bastante más caro** que generar texto. El cost-guard actual cuenta llamadas de
texto (`DAILY_LLM_LIMIT = 15`) en [services/content-suggestions/cost-guard.js](services/content-suggestions/cost-guard.js).
**No existe ningún cost-guard de imagen** — grep completo del repo confirma que no hay ningún
archivo ni símbolo `DAILY_IMAGE_LIMIT`. La propuesta sigue siendo agregar uno (decisión de diseño ya
tomada, implementación pendiente):

- **Límite bajo:** `DAILY_IMAGE_LIMIT ≈ 10` **generaciones** por tenant/día (cada generación = 3
  variantes; el contador cuenta generaciones, no variantes sueltas).
- **Fail-closed:** a diferencia del cost-guard de texto (que degrada **abierto**), si Redis no
  responde el de imagen **bloquea** la generación. La imagen es la pieza más cara: ante incertidumbre,
  no gastar. Contraste explícito con el cost-guard de texto y con el del chatbot ([[Chat de tienda]]).
- **Contador Redis separado** del de texto, por tenant/día.
- El **texto del pipeline** (etapas ver→describir / enriquecer / skill de diseñador) cuenta contra el
  cost-guard de **texto**, no contra el de imagen: son llamadas de texto baratas (ver [[#Pipeline multi-etapa (dirección elegida)]]).

## Endpoints propuestos — sigue sin existir ninguno

`routes/content-suggestions.js` hoy solo tiene `/`, `/today`, `/products/:productId/angles`,
`/products/:productId/generate`, `/refine` — nada de imagen. `controllers/content-suggestions.js`
tampoco tiene handlers para imagen. Todos los de la tabla de abajo mantendrían `verifyToken` +
`requireRole(["ADMIN","STAFF"])` (igual que el resto del router). Borrador, nada implementado:

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

1. ~~**Cliente de imagen**~~ — **hecho**: `lib/llm/image.js` + `providers/gemini-image.js`, config
   (`IMAGE_PROVIDER`, `GEMINI_IMAGE_MODEL`), best-effort con degradación a `{ images: [], model: null }`.
2. ~~**Modelo de datos + Cloudinary**~~ — **hecho**: `SuggestionImage` en `prisma/schema.prisma`
   (migración aplicada) y `services/content-suggestions/images.js` (`persistVariants`/`chooseVariant`/
   `deleteVariant`) vía `uploadBase64ToCloudinary`.
3. ~~**Pipeline de prompt**~~ — **hecho**: `lib/llm/image-prompt.js` con las tres etapas ya cableadas
   (ver→describir, enriquecer, skill de diseñador), no colapsado a 1 etapa.
4. **Overlay de texto/precio** — transformaciones Cloudinary (`l_text:`) sobre la variante elegida.
   **Pendiente**, sin evidencia de código en esta revisión.
5. **Endpoints + schemas** — generar (3 variantes) / elegir / borrar / status, con validación Zod.
   **Pendiente** — es el gap principal: la librería existe pero nada la expone por HTTP.
6. **Cost-guard de imagen** — contador Redis separado, `DAILY_IMAGE_LIMIT ≈ 10`, **fail-closed**.
   **Pendiente**, no existe ningún símbolo `DAILY_IMAGE_LIMIT` en el repo.
7. **Cablear `SuggestionStatus`** — transiciones `USED` / `DISMISSED`. **Pendiente**.
8. **Frontend** — selector de opciones, galería de 3 variantes, panel actualizado. **Pendiente**.
9. **Reposicionar copy/hashtags** — ajustes al system prompt de texto (resolver vs. describir,
   hashtags cazadores). **Pendiente**.
