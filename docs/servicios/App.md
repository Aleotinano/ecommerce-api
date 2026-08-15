---
tags: [indice, servicios]
estado: en-desarrollo
ultima-revision: 2026-08-07
lado: backend
---

# Índice de servicios

Documentación de los servicios del backend (SaaS multi-tenant de ecommerce — Node + Express 5 +
Prisma + PostgreSQL + Redis, ESM). El código es la única fuente de verdad: lo que no está en el
código se marca como `> [!todo] TBD`.

> [!note] Estado de la documentación
> - ✅ Documentados: [[Órdenes]], [[Sugerencias de contenido]], [[Productos]], [[TenantConfig]],
>   [[Categorías]], [[Combos]], [[Variantes]], [[Carrito]], [[MercadoPago]], [[Estadísticas]], [[Roles]],
>   [[Direcciones]], [[Perfiles de flujo de venta]], [[Caja]], [[Cloudinary por tenant]]
> - ⚠️ Implementado **sin doc de dominio**: Promos (descuento por cantidad, `services/promos.js` + `/promos`)
> - 📐 Propuestas: [[Sugerencias de contenido — Imágenes (propuesta)]] (librería lista, feature no
>   expuesta), [[Producción sin cuentas (propuesta)]] (plan puro, nada implementado),
>   [[Caja — día operativo (propuesta)]] (el modelo de [[Caja]] con la entidad Día y hora de corte),
>   [[Insumos (propuesta)]] (el costo de mercadería que le falta a [[Caja]] para dar margen; nada
>   implementado)
> - 🟡 Stubs (pendientes de documentar): el resto
>
> Estructura: los servicios viven en `dominio/` y las abstracciones en `transversales/`; este índice
> queda en la raíz de `docs/servicios/`. Los `[[wikilinks]]` resuelven por nombre, independiente de la
> carpeta.

> [!abstract] Este índice es un hemisferio, no el vault entero
> `App.md` cubre el **backend**. La documentación de interfaz vive en el otro hemisferio
> ([[Frontend]]), los contratos de la API en `contratos/` y las decisiones tomadas con el cliente en
> `producto/`. El mapa completo está en [[Índice]].

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

- [[Productos]] — catálogo de productos del tenant, con tipo explícito (`PRODUCTO`/`COMBO`).
  `services/productos.js`, `controllers/store/products.js`.
- [[Categorías]] — categorías y subcategorías (árbol `parent`/`children`) por tenant, orden configurable
  vía `position`. `services/categories.js`.
- [[Variantes]] — variantes de `PRODUCTO` (atributos flexibles por tenant, stock, SKU único por tenant;
  siempre hay al menos una — la default). `services/variants.js`.
- [[Carrito]] — carrito por `userId` o por `guestId` (invitado sin login), ítems por `productId`
  (+ `variantId`, null solo para COMBO). `services/cart.js`.
- [[Órdenes]] — creación de orden desde el carrito (con o sin cuenta), máquina de estados y libro de
  cobros (`OrderPayment`: una fila por cobro, con vía y monto; `paymentStatus` se deriva de ahí).
  `services/orders.js` + `services/order-state.js` (motor puro: transiciones, `blockers`, resumen de
  dinero y avance automático a `PROCESSING`).
- [[Direcciones]] — libreta de direcciones del cliente del storefront (`UserAddress`), desacoplada de la
  orden: el checkout copia los campos como snapshot. `services/addresses.js`, `controllers/store/addresses.js`.
- **Promos** — descuento por cantidad (escalones `minQty` → `%`) aplicado al pricear.
  `services/promos.js`. *(sin doc de dominio todavía)*
- [[MercadoPago]] — integración de pagos (preferencias, webhook, `paymentStatus`). `services/mercadopago.js`.
- [[Estadísticas]] — métricas y reportes del tenant (ventas, productos, ventanas temporales). `services/stats.js` + `services/stats/*`.
- [[Usuarios y Auth]] — registro/login, verificación de email, usuarios del tenant. `services/users.js`, `controllers/store/auth.js`.
- [[Roles]] — roles `ADMIN`/`STAFF`/`CUSTOMER` y autorización. `services/role.js`, `middleware/role.js`.
- [[TenantConfig]] — configuración por tenant. Dos clases de campo: lo que edita el tenant (branding,
  contacto, SEO, políticas, tema, WhatsApp) y lo que configuramos nosotros (el flujo de venta).
  `services/tenant-config.js`.
- [[Perfiles de flujo de venta]] — kits de arranque de la configuración de venta de un tenant
  (`estandar` / `contraentrega` / `produccion-por-sena`): qué métodos de pago y entrega acepta y si
  cobra seña. Módulo puro `services/tenant-profiles.js` + `prisma/set-tenant-profile.js`.
- [[Sugerencias de contenido]] — sugerencia diaria de contenido para redes generada con LLM (modelo push, una por día). `services/content-suggestions/*`.
- [[Sugerencias de contenido — Imágenes (propuesta)]] — **librería lista, feature no expuesta**: el
  cliente de imagen, el pipeline de prompt, el modelo `SuggestionImage` y la persistencia en Cloudinary
  ya están implementados y testeados; falta exponerlo (endpoints, cost-guard de imagen, cablear
  `SuggestionStatus`).
- [[Chat de tienda]] — asistente conversacional del storefront con tools sobre el catálogo. `services/chat/*`.
- [[WhatsApp]] — webhook de WhatsApp Business (Meta Graph API), resolución de tenant por número. `services/whatsapp/*`.
- [[Combos]] — productos compuestos de otros productos, el cliente arma su propio combo eligiendo
  entre productos permitidos. `services/combos.js`, `services/productos.js`, `services/cart.js`,
  `services/orders.js`. Ver también [[mesa dulce demo]].
- [[Caja]] — turno de caja física: apertura, movimientos, arqueo. Además del cobro de las órdenes
  (que cae solo, un movimiento por fila del libro), es el libro de la plata del local: sueldos,
  insumos y retiros con etiqueta del catálogo del tenant y destinatario. Opt-in por tenant
  (`cashRegisterEnabled`, hoy apagado en todos). `services/cash-register.js` +
  `services/cash-register-math.js` (puro), `prisma/set-cash-register.js`.
- [[Producción sin cuentas (propuesta)]] — cómo integrar que [[mesa dulce demo|Mesa Dulce]] opere sin
  registro ni login: qué endpoints de [[Usuarios y Auth]] se apagan, cómo se entregan las
  credenciales de admin, y por qué hoy **el invitado no recibe ningún mail de cambio de estado**.
  **Plan, nada implementado.**

## Tenants

Fichas de los clientes que pasaron por acá: qué se cargó, con qué criterio y qué les falta.

- [[new-tenant-config]] — **el patrón de alta**, destilado de todos los anteriores. Los cuatro
  pasos, cómo elegir el perfil, qué no inventar y las trampas ya verificadas.
- [[maikai]] — café/bar/restó en San Juan. Primer `carta` completo (`storeMode: MENU`): 251
  productos, 8 raíces que son los tiles de la home, pipeline dump → `build-menu.js` → seeds.
- [[punto-healthy]] — franquicia de comida rápida saludable, en modo tienda (`estandar`). Primer
  catálogo con **combos y variantes reales** cargados por seed: 31 productos / 57 variantes / 11
  promos. Su ficha describe la fricción entre la whitelist de combo (por producto) y las
  presentaciones de la carta (por variante) — el backend ya la resuelve con `allowedVariantId`,
  pero **su catálogo todavía no está migrado** a usarlo.
- [[pastaia]] — pastas caseras congeladas, en modo tienda (`estandar`). Primer tenant con **dos
  ejes de variación en el mismo producto** (masa × caja): 15 productos / 111 variantes desde una
  spec matricial. Motivó `allowedVariantId` en [[Combos]]. **En preparación**: faltan precios y
  contacto, el seed no se corrió.
- [[mesa dulce demo]] — mesa dulce para eventos, en modo tienda. Log de la sesión de demo:
  combos reales, rediseño de tipos de producto. **Congelado en 2026-07-08**, con anotaciones
  de lo que quedó obsoleto.

## Abstracciones transversales

- [[Multi-tenancy]] — resolución de `tenantId` por subdominio o header `X-Tenant-Slug` (ambos
  dominados por el cliente), revalidado contra el `tenantId` del JWT en rutas con sesión; sin scoping
  automático a nivel de Prisma (convención por servicio, no garantía del ORM). `middleware/tenant.js`.
- [[Auth y tokens]] — autenticación Bearer y emisión/verificación de tokens. `middleware/auth.js`, `lib/tokens.js`.
- [[Cliente LLM]] — cliente provider-agnóstico (Anthropic / Gemini) con fallback y parseo de salida. `lib/llm/*`.
- [[Agente LLM]] — loop de agente con tool-calling para el chat. `lib/llm/agent.js`, `lib/llm/tools/`.
- [[Redis y cache]] — cache y contadores con degradación **mixta**: abierta en cache/contadores, cerrada en el cost-guard del chat ([[Chat de tienda]]). `lib/cache.js`, `lib/redis.js`.
- [[Crypto]] — cifrado AES-256-GCM de los secretos per-tenant en reposo (token de WhatsApp, credenciales de Cloudinary). `lib/crypto.js`.
- [[Mailer]] — envío de emails transaccionales (verificación, cambios de estado de orden). `lib/mailer.js`.
- [[Rate limiting]] — límites de tasa por ruta/identidad. `middleware/rateLimit.js`.
- [[Almacenamiento de imágenes]] — subida/borrado de imágenes en Cloudinary. `lib/cloudinary.js`, `lib/imageManager.js`.
- [[Cloudinary por tenant]] — cada cliente con su propia cuenta sobre una instancia multi-tenant única; credenciales cifradas en `TenantConfig` y resueltas en runtime, con fallback a la cuenta global. `lib/cloudinary.js`.
