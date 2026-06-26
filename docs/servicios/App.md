---
tags: [indice, servicios]
estado: en-desarrollo
ultima-revision: 2026-06-20
---

# Índice de servicios

Documentación de los servicios del backend (SaaS multi-tenant de ecommerce — Node + Express 5 +
Prisma + PostgreSQL + Redis, ESM). El código es la única fuente de verdad: lo que no está en el
código se marca como `> [!todo] TBD`.

> [!note] Estado de la documentación
> - ✅ Documentados: [[Órdenes]], [[Sugerencias de contenido]]
> - 📐 Propuestas (diseño, sin código): [[Sugerencias de contenido — Imágenes (propuesta)]]
> - 🟡 Stubs (pendientes de documentar): el resto
>
> Estructura: los servicios viven en `dominio/` y las abstracciones en `transversales/`; este índice
> queda en la raíz de `docs/servicios/`. Los `[[wikilinks]]` resuelven por nombre, independiente de la
> carpeta.

## Convenciones

### `estado` (frontmatter)
El eje es **qué cambio se espera próximo, no la ausencia de deuda**. Un servicio puede ser `estable`
y tener un bug; si el bug pide rework, es `refactor-pendiente`.

- `estable` — ni el contrato (superficie/API) ni los internos tienen un cambio pendiente conocido.
- `en-desarrollo` — el contrato todavía se va a mover (campos, enums o endpoints esperando trabajo).
- `refactor-pendiente` — el contrato es estable, pero hay deuda interna conocida que pide rework.
- Si aplica más de uno, gana el cambio más inminente o comprometido.

### Etiquetas de deuda
Dentro de "Deuda técnica" cada ítem se etiqueta por **tipo de acción**, para que la lista sea triable:

- `[bug]` — comportamiento incorrecto. Acción: arreglar (suele ser diseño).
- `[comentario-miente]` — la doc-en-código contradice al código. Acción: corregir el comentario (trivial).
- `[código-muerto]` — existe pero nada lo usa. Acción: decidir **quitar o cablear** (la decisión vive en "Preguntas abiertas").
- `[riesgo]` — no es un bug hoy, pero es frágil/ambiguo y puede causar uno. Acción: endurecer (validar, renombrar, lock preventivo).
- `[nota]` — informativo, no accionable como deuda.

## Servicios de dominio

- [[Productos]] — catálogo de productos del tenant (precio obligatorio, imagen, categoría). `services/productos.js`, `controllers/store/products.js`.
- [[Categorías]] — categorías y subcategorías (árbol `parent`/`children`) por tenant. `services/categories.js`.
- [[Variantes]] — variantes de producto (color, talle, stock, SKU único por tenant). `services/variants.js`.
- [[Carrito]] — carrito por usuario, ítems por variante. `services/cart.js`.
- [[Órdenes]] — creación de orden desde el carrito y máquina de estados de la orden. `services/orders.js`.
- [[MercadoPago]] — integración de pagos (preferencias, webhook, `paymentStatus`). `services/mercadopago.js`.
- [[Estadísticas]] — métricas y reportes del tenant (ventas, productos, ventanas temporales). `services/stats.js` + `services/stats/*`.
- [[Usuarios y Auth]] — registro/login, verificación de email, usuarios del tenant. `services/users.js`, `controllers/store/auth.js`.
- [[Roles]] — roles `ADMIN`/`STAFF`/`CUSTOMER` y autorización. `services/role.js`, `middleware/role.js`.
- [[TenantConfig]] — configuración de marca por tenant (branding, contacto, SEO, políticas, WhatsApp). `services/tenant-config.js`.
- [[Sugerencias de contenido]] — sugerencia diaria de contenido para redes generada con LLM (modelo push, una por día). `services/content-suggestions/*`.
- [[Sugerencias de contenido — Imágenes (propuesta)]] — **propuesta (sin código)**: reorientar la feature a la imagen publicitaria generada por IA como entregable principal, con copy/hashtags complementarios.
- [[Chat de tienda]] — asistente conversacional del storefront con tools sobre el catálogo. `services/chat/*`.
- [[WhatsApp]] — webhook de WhatsApp Business (Meta Graph API), resolución de tenant por número. `services/whatsapp/*`.

## Abstracciones transversales

- [[Multi-tenancy]] — resolución e inyección de `tenantId`; el cliente nunca lo envía. `middleware/tenant.js`.
- [[Auth y tokens]] — autenticación Bearer y emisión/verificación de tokens. `middleware/auth.js`, `lib/tokens.js`.
- [[Cliente LLM]] — cliente provider-agnóstico (Anthropic / Gemini) con fallback y parseo de salida. `lib/llm/*`.
- [[Agente LLM]] — loop de agente con tool-calling para el chat. `lib/llm/agent.js`, `lib/llm/tools/`.
- [[Redis y cache]] — cache y contadores con degradación **mixta**: abierta en cache/contadores, cerrada en el cost-guard del chat ([[Chat de tienda]]). `lib/cache.js`, `lib/redis.js`.
- [[Crypto]] — cifrado AES-256-GCM (tokens de WhatsApp por tenant). `lib/crypto.js`.
- [[Mailer]] — envío de emails transaccionales (verificación, cambios de estado de orden). `lib/mailer.js`.
- [[Rate limiting]] — límites de tasa por ruta/identidad. `middleware/rateLimit.js`.
- [[Almacenamiento de imágenes]] — subida/borrado de imágenes en Cloudinary. `lib/cloudinary.js`, `lib/imageManager.js`.
