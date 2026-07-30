# ARCHITECTURE.md

> Documento técnico generado a partir del código real del repositorio. No describe
> intenciones ni roadmap: solo lo que está implementado. Lo que no existe en el código se
> marca como **no presente** o **TODO**.
>
> **Alcance:** este repositorio es **solo backend** (API HTTP). No contiene una aplicación
> frontend (ver §10).

---

## 1. Stack y setup

### Lenguaje / runtime
- **Node.js, ESM puro** (`"type": "module"` en `package.json`). Entry point: `app.js`
  (`"main": "app.js"`).
- No hay build de TypeScript del backend: el código de runtime es `.js`. TypeScript está
  como devDependency (hay `prisma.config.ts`, `lib/cloudinary.ts` y `tsx`), pero la app se
  ejecuta con `node app.js`.

### Package manager
- **pnpm 10.24.0** (declarado en `package.json` → `"packageManager": "pnpm@10.24.0..."`).
- Existe `pnpm-workspace.yaml` y `pnpm-lock.yaml`.

### Dependencias principales (de `package.json`)

| Categoría | Paquetes (versión exacta del `package.json`) |
|---|---|
| HTTP / server | `express@5.2.1`, `helmet@^8.1.0`, `compression@1.8.1`, `cors@2.8.5`, `cookie-parser@1.4.7`, `morgan@1.10.1` |
| Logging | `pino@^9.14.0`, `pino-http@^10.5.0` (dev: `pino-pretty`) |
| DB / ORM | `@prisma/adapter-pg@7.3.0`, `@prisma/client-runtime-utils@^7.4.2`, `pg@8.17.2` (dev: `prisma@7.3.0`, `@prisma/client@7.3.0`) |
| Auth / crypto | `jsonwebtoken@9.0.3`, `argon2@0.44.0` |
| Validación | `zod@4.3.6` |
| Rate limit / cache | `express-rate-limit@^8.2.1`, `rate-limit-redis@^4.2.0`, `ioredis@^5.4.1` |
| Pagos | `mercadopago@^2.12.0` |
| Imágenes / uploads | `cloudinary@^2.9.0`, `multer@^2.1.1` |
| Email | `nodemailer@^6.10.1` |
| Excel | `exceljs@4.4.0` (exportación del turno de caja; elegida sobre `xlsx`/SheetJS, cuya versión en npm está congelada y con CVEs) |
| Dev / test | `vitest@^4.1.6`, `supertest@^7.2.2`, `eslint@9.39.2` + `standard@17.1.2`, `nodemon@3.1.11`, `typescript@5.9.3`, `tsx@4.21.0`, `dotenv@17.2.3` |

> Nota: ESLint usa el preset `standard` (`eslintConfig.extends: "standard"`).

### Scripts (`package.json`)

| Script | Comando | Para qué |
|---|---|---|
| `start` | `node app.js` | Arranca el servidor |
| `dev` | `nodemon app.js` | Desarrollo con reload |
| `test` | `vitest run` | Tests (una pasada) |
| `test:watch` | `vitest` | Tests en watch |
| `seed` | `node prisma/seed.js` | Seed base |
| `seed:stats` | `node prisma/seed-stats.js` | Seed de datos para stats |
| `seed:config` | `node prisma/seed-tenant-config.js` | Seed de `TenantConfig` (perfil de flujo + branding) |
| — | `node prisma/set-tenant-profile.js <slug> <perfil>` | Aplica un perfil de flujo de venta a un tenant. Sin argumentos lista perfiles y el estado de cada tenant. **No** es un script de npm: es operación manual, no parte de ningún seed |
| — | `node prisma/set-cash-register.js <slug> on\|off` | Habilita o apaga el módulo de caja de un tenant (y siembra las 7 etiquetas por defecto al prenderlo). Sin argumentos lista el estado de cada tenant. Operación manual, como el anterior — **ojo**: prendido, cobrar sin turno abierto falla |
| `seed:catalog` | `node prisma/seed-catalog.js` | Seed de catálogo |
| `seed:mesa-dulce` | `node prisma/mesa-dulce/index.js` | Seed completo del primer tenant real (categorías + productos + órdenes) |
| `seed:mesa-dulce:categorias` | `node prisma/mesa-dulce/categorias.js` | Solo categorías de ese tenant |
| `seed:mesa-dulce:productos` | `node prisma/mesa-dulce/productos.js` | Solo productos/combos de ese tenant |
| `seed:mesa-dulce:ordenes` | `node prisma/mesa-dulce/ordenes.js` | Solo órdenes de ejemplo de ese tenant |

> ⚠️ `pnpm seed` hace un **TRUNCATE completo** antes de sembrar. No correrlo contra una base con
> datos reales cargados.

### Infraestructura local
- `docker-compose.yml` levanta **solo Redis** (`redis:7-alpine`, puerto `6379`, AOF
  `--appendonly yes`, `--maxmemory 256mb --maxmemory-policy allkeys-lru`).
- **PostgreSQL no está en el compose** → la base de datos es externa/manual (se conecta vía
  `DATABASE_URL`).

### Variables de entorno

Fuente única de verdad: `schemas/env.schema.js` (validado con zod en `config.js` mediante
`envSchema.parse(process.env)`). Se listan **solo las claves** (sin valores). `*` = requerida
(falla el arranque si falta); el resto es opcional o tiene default.

| Clave | Requerida | Default / nota |
|---|---|---|
| `NODE_ENV` | no | `development` (`development`\|`production`\|`test`) |
| `PORT` | no | `3001` |
| `DATABASE_URL` | **sí** | string no vacío |
| `SECRET_JWT_KEY` | **sí** | firma de JWT |
| `BASE_URL` | **sí** | URL |
| `APP_URL` | no | cae a `BASE_URL` |
| `STORE_APP_URL` | no | `http://localhost:3000` |
| `PUBLIC_KEY` | **sí** | (MercadoPago public key) |
| `ACCESS_TOKEN` | **sí** | (MercadoPago access token) |
| `CLOUDINARY_CLOUD_NAME` | **sí** | leída directo por `lib/cloudinary.js` (ver §11) |
| `CLOUDINARY_API_KEY` | **sí** | idem |
| `CLOUDINARY_API_SECRET` | **sí** | idem |
| `CLOUDINARY_FOLDER` | no | `e-commerce-express` |
| `ORIGINS` | no | CSV de orígenes CORS permitidos |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | no | SMTP nodemailer |
| `SMTP_SECURE` | no | `"true"`/`"false"` → boolean (default false) |
| `MAIL_FROM` | no | `no-reply@localhost` |
| `LOG_LEVEL` | no | `info` en prod, `debug` fuera de prod |
| `REDIS_URL` | no | si falta usa `localhost:6379` |
| `CACHE_ENABLED` | no | boolean: `true` salvo que sea exactamente `"false"` |
| `LLM_PROVIDER` | no | `gemini` (\|`anthropic`) |
| `ANTHROPIC_API_KEY` | no | — |
| `ANTHROPIC_MODEL` | no | `claude-haiku-4-5` |
| `ANTHROPIC_BASE_URL` | no | `https://api.anthropic.com` (apuntable a un server compat de la Messages API, p. ej. Ollama en dev) |
| `GEMINI_API_KEY` | no | — |
| `GEMINI_MODEL` | no | `gemini-2.5-flash` |
| `IMAGE_PROVIDER` | no | `gemini` (generación de imágenes image-to-image, reusa `GEMINI_API_KEY`) |
| `GEMINI_IMAGE_MODEL` | no | `gemini-2.5-flash-image` |
| `CHAT_DAILY_LIMIT` | no | `500` (cost-guard del chat de tienda, por tenant) |
| `WHATSAPP_VERIFY_TOKEN` | no | handshake de verificación del webhook (Graph API) |
| `WHATSAPP_APP_SECRET` | no | valida la firma `X-Hub-Signature-256` de los mensajes entrantes |
| `WHATSAPP_ACCESS_TOKEN` | no | token global de fallback si el tenant no tiene el suyo en DB |
| `WHATSAPP_PHONE_NUMBER_ID` | no | número de prueba en dev; en prod cada tenant tiene el suyo en `TenantConfig` |
| `WHATSAPP_GRAPH_API_VERSION` | no | `v21.0` |
| `WHATSAPP_TOKEN_ENC_KEY` | no | clave AES-256-GCM (32 bytes, hex o base64) para cifrar `TenantConfig.whatsappAccessToken` en reposo; sin ella no se guardan ni usan tokens de DB |

Todas las variables de WhatsApp son opcionales: si faltan, el módulo queda inactivo y la app
arranca igual (`schemas/env.schema.js`).

Hay archivos `.env` y `.env.test` en el repo (no se documenta su contenido).

---

## 2. Estructura de carpetas

Árbol principal (2-3 niveles, excluyendo `node_modules`):

```
e-commerce-express-1/
├── app.js                  # Bootstrap Express: middlewares globales + montaje de routers
├── config.js               # Carga/valida env (DEFAULTS); única fuente de config
├── prisma.config.ts        # Config de Prisma CLI
├── docker-compose.yml      # Solo Redis
├── vitest.config.js
├── routes/                 # Definición de endpoints (Router de Express) por feature
│   ├── store/              # Sub-API "storefront" (auth, products, categories, cart, orders, addresses, config, mercadopago, chat, page)
│   └── webhooks/           # whatsapp.js — webhook de WhatsApp Business, montado FUERA de /store
├── controllers/            # Handlers HTTP: parsean req, llaman al service, arman respuesta
│   ├── store/              # Controllers de la storefront
│   └── webhooks/           # whatsapp.js
├── services/               # Lógica de negocio. Cada feature exporta un objeto `XModel`
│   ├── stats/              # Dashboard: queries.js, builders.js, money.js (cobranzas + caja, puro), order-helpers.js, utils.js, constants.js, README.md
│   ├── content-suggestions/# index.js (fachada) + selection.js, angles.js, queries.js, cost-guard.js
│   ├── whatsapp/           # Bot de WhatsApp: index.js, signature.js, history.js, rate-limit.js, graph-api.js, dedup.js, tenant-resolver.js
│   ├── chat/               # Agente de chat de tienda: index.js, tools.js, prompt.js, cost-guard.js
│   ├── combos.js           # Archivo único (no carpeta): validateComboSelection, compartido por cart.js y orders.js
│   ├── order-state.js      # Motor de estados de órdenes (puro): transiciones, blockers y avance automático
│   ├── tenant-profiles.js  # Perfiles de flujo de venta (puro): kits de arranque de la config de venta
│   ├── cash-register.js    # Caja: turno, movimientos, etiquetas + recordOrderPayments (enganche con el libro de cobros)
│   ├── cash-register-math.js   # Aritmética del arqueo (puro): signos, resumen por etiqueta, diferencia
│   ├── cash-register-export.js # El turno a .xlsx (exceljs); sin DB, recibe el turno y devuelve buffer
│   └── cash-register-schedule.js # Turnos con horario (puro): qué turno es ahora, vencimiento, gracia
├── lib/                    # Infra/integraciones: prisma, redis, cache, logger, mailer, cloudinary, tokens, slug, imageManager, crypto (AES-256-GCM), phone (normalización E.164), whatsapp-link (deep-link wa.me del pedido — módulo puro, NO es el bot)
│   └── llm/                # Cliente LLM: index.js, prompt.js, parse.js, fallback.js
│       ├── providers/      # anthropic.js, gemini.js (fetch directo, sin SDK)
│       └── tools/          # schema.js — specs de tools del agente (TOOL_DEFINITIONS, AUTHENTICATED_TOOLS, CHANNEL_ORDER_TOOLS)
├── middleware/             # auth, role, tenant, cors, rateLimit, validate, upload, errorHandler, httpLogger, guestCart (cookie de invitado), storeCache (Cache-Control/Vary de /store)
├── schemas/                # Schemas zod (env, auth, product, order, combo, chat, page-spec, stats, content-suggestion, etc.)
├── helpers/                # error.js (createError), password.js (argon2), price.js (getProductPrice/resolveProductStock), etc.
├── utils/                  # Utilidades varias
├── prisma/
│   ├── schema.prisma       # Modelo de datos
│   ├── migrations/         # 49 migraciones SQL
│   ├── mesa-dulce/         # Seed del primer tenant real (categorias.js, productos.js, ordenes.js, index.js)
│   └── seed*.js            # Seeds (base, stats, tenant-config, catalog) + scripts de migración de datos
├── generated/prisma/       # Cliente Prisma generado (output custom, fuera de node_modules)
├── tests/                  # Tests (vitest + supertest)
├── front-md-guia/          # GUÍAS markdown de integración para un frontend externo (no es código)
├── config/                 # (config auxiliar)
├── tmp/                    # temporales
└── .agents/                # (configuración de agentes)
```

`app.js` aplica los middlewares globales en este orden: `helmet()` → `middleWare()` (CORS) →
`/webhooks/whatsapp` (**antes** del parser JSON global) → `express.json({ limit: "10kb" })` →
`cookieParser()` → `compression()` → `httpLogger` → `generalLimiter`, y luego monta el resto de
routers; cierra con `notFoundHandler` + `errorHandler`.

> El webhook de WhatsApp necesita el **raw body** para validar la firma HMAC
> (`X-Hub-Signature-256`), por eso se monta antes que `express.json()` global y arma su propio
> `express.json({ verify })` que guarda el buffer crudo en `req.rawBody`
> (`routes/webhooks/whatsapp.js`).

---

## 3. Modelo de datos (Prisma)

Fuente: `prisma/schema.prisma`. Datasource `postgresql`; **el `datasource db` no declara
`url`** (la conexión se inyecta vía `@prisma/adapter-pg` con `DATABASE_URL`, ver `lib/prisma.js`).
Generador con `output = "../generated/prisma"`.

### Modelos

| Modelo | Campos clave (tipo) | Relaciones | `tenantId` |
|---|---|---|---|
| **Tenant** | `id`, `slug @unique`, `name`, `isActive=true`, `createdAt`, `updatedAt` | 1-N: users, addresses, categories, products, variants, carts, orders, promos, contentSuggestions, comboAllowedProducts, suggestionImages; 1-1: config, pageSpec | N/A (es el tenant) |
| **TenantConfig** | branding (`logoUrl`, `storeName`, `storeTagline`…), contacto, social, SEO, políticas; **tema** `themeAccent?`, `themeRadius?`, `themeFontDisplay?`, `themeFontBody?`, `themeWeightDisplay?`, `themeWeightBody?`, `themeDensity?` (texto libre a propósito: el catálogo de fuentes/enums vive en `@repo/shared` y evoluciona sin migración) + `themeSections: Json?` (overrides por sección nav/hero/catalog/footer); **teléfono del cliente** `customerPhoneMode?="required"` (`off`\|`optional`\|`required`, CHECK en la migración), `customerPhoneCountry?="54"`, `customerPhoneArea?`; `currency=ARS`, `locale=es-AR`, `showOutOfStock=false`, `allowCartGuest=true`, `productVariantsEnabled=true`, `whatsappPhoneNumberId? @unique`, `whatsappAccessToken?` (cifrado AES-256-GCM); **flujo de venta — lo configuramos nosotros, no el tenant** (§6): `paymentMethodsEnabled=[CASH,TRANSFER,MIXED]`, `fulfillmentMethodsEnabled=[DELIVERY,PICKUP]` (arrays de enum), `depositEnabled=false`, `depositPercentage=50` | 1-1 `Tenant` (`onDelete: Cascade`) | **Sí** (`tenantId @unique`) |
| **User** | `id`, `username`, `email`, `password`, `phone?` (E.164 en dígitos, normalizado en `lib/phone.js`; **no** es credencial ni tiene unique), `role: Role=CUSTOMER`, `emailVerified=false`, `emailVerificationTokenHash?`, `emailVerificationExpiresAt?` | 1-1 cart, 1-N orders, 1-N addresses, N-1 tenant | **Sí** |
| **UserAddress** | `id`, `userId`, `label` ("mi casa"), `addressText?`, `addressLat?`, `addressLng?`, `addressDetails?`, `addressMapsUrl?` (hace falta `addressText` y/o `addressMapsUrl`, CHECK en la migración), `isDefault=false`, `createdAt`, `updatedAt` — libreta de direcciones del cliente. **NO es la dirección de la orden**: el checkout copia estos campos a las columnas planas de `Order` (snapshot histórico) y `Order` no tiene FK acá, así que el borrado es físico y no altera pedidos cerrados | N-1 user (`onDelete: Cascade`), N-1 tenant | **Sí** |
| **Categories** | `id`, `name`, `description?`, `icon?`, `imageUrl?`, `imgPublicId?`, `isActive=true`, `parentId?` (self-relation árbol), `position=0` (orden de display, agregado 2026-07-20) | self `parent`/`children`, 1-N products, N-1 tenant, N-1 ComboAllowedCategory | **Sí** |
| **Product** | `id`, `name`, `description?`, `price: Float?` (exclusivo de `COMBO`; `null` para `PRODUCTO`, el precio real vive en la variante default), `img?`, `imgPublicId?`, `categoryId?`, `isActive=true`, `createdAt`, `type: ProductType`, `isCombo=false` (deprecado, no se lee en runtime), `comboMinItems?`, `comboMaxItems?` | 1-N variants, N-1 category, N-1 tenant, 1-N contentSuggestions, 1-N cartItems, 1-N orderItems, 1-N comboOptions/allowedInCombos (`ComboAllowedProduct`), 1-N comboCategoryOptions (`ComboAllowedCategory`) | **Sí** |
| **ProductVariant** | `id`, `productId`, `attributes: Json={}` (pares key→valor del catálogo `TenantAttribute` del tenant, ej. `{"color":"#fff","talle":"M"}` o `{"sabor":"chocolate"}`; validados/normalizados en `services/tenant-attributes.js`), `price: Float` (NOT NULL), `stock: Int`, `sku`, `img?`, `imgPublicId?`, `isActive=true`, `isDefault=false` (marca la variante "principal" de un `PRODUCTO`; a lo sumo una `true` por producto) | N-1 product (`onDelete: Cascade`), N-1 tenant, 1-N cartItems, 1-N orderItems | **Sí** — todo `Product.type = "PRODUCTO"` tiene **siempre** al menos una fila (la default); `COMBO` no tiene ninguna |
| **TenantAttribute** | `id`, `key` (slug estable: `color`, `talle`, `sabor`…), `label` (display), `type: AttributeType=TEXT` (`TEXT` \| `COLOR` — COLOR exige valor HEX), `position=0` (orden de display/normalización) — catálogo de atributos de variante del tenant, seteo **one-time** en el onboarding (`PUT /tenant-attributes/:tenantId` devuelve 409 si ya existe) | N-1 `Tenant` (`onDelete: Cascade`) | **Sí** (`@@unique([tenantId, key])`) |
| **ComboAllowedProduct** | `id`, `comboProductId`, `allowedProductId`, `comboAllowedCategoryId?`, `minQty=0`, `maxQty?`, `isActive=true`, `createdAt` — con FK null: regla standalone legacy (min/max per-producto); con FK: MIEMBRO explícito de esa regla de categoría (min/max no se usan) | N-1 `Product` como `comboProduct` (`onDelete: Cascade`) y como `allowedProduct` (`onDelete: Cascade`), N-1 opcional `ComboAllowedCategory` (`onDelete: Cascade`), N-1 tenant | **Sí** |
| **ComboAllowedCategory** | `id`, `comboProductId`, `categoryId`, `minQty=0`, `maxQty?`, `isActive=true`, `createdAt` — whitelist de categorías permitidas en un combo; `minQty`/`maxQty` son el TOTAL DEL GRUPO (suma elegida de la categoría; el admin manda min=max exacto); sin `members` = toda la categoría; no baja a subcategorías | N-1 `Product` (`onDelete: Cascade`), N-1 `Categories` (`onDelete: Cascade`), 1-N `members` (`ComboAllowedProduct`), N-1 tenant | **Sí** |
| **Promo** | `id`, `name`, `description?`, `isActive=true`, `createdAt` — promo de descuento por cantidad | 1-N tiers, 1-N products, N-1 tenant | **Sí** |
| **PromoTier** | `id`, `promoId`, `minQty`, `discountPercentage: Float`, `createdAt` — escalón de descuento (a partir de N unidades, X %) | N-1 promo (`onDelete: Cascade`), N-1 tenant | **Sí** |
| **PromoProduct** | `id`, `promoId`, `productId`, `createdAt` — join promo↔producto; sin `isActive` propio (el estado vive en `Promo.isActive`) | N-1 promo (`onDelete: Cascade`), N-1 product (`onDelete: Cascade`), N-1 tenant | **Sí** |
| **Cart** | `id`, `userId? @unique` (nullable: carrito de invitado), `guestId?` (UUID de la cookie httpOnly `guest_cart_id`), `createdAt`, `updatedAt` | 1-1 user (opcional), N-1 tenant, 1-N items | **Sí** |
| **CartItem** | `id`, `cartId`, `productId`, `variantId?` (nullable solo para líneas COMBO — un `PRODUCTO` siempre resuelve variante), `comboSelection: Json?` (selección de componentes elegida por el cliente para un combo), `quantity=1`, `createdAt` | N-1 cart, N-1 product, N-1 variant | **No** (scope vía Cart) |
| **Order** | `id`, `userId?` (nullable — órdenes BOT nacen sin usuario), `status: OrderStatus=PENDING`, `total: Float`, `paymentStatus: PaymentStatus=PENDING`, `paymentId?`, `mercadoPagoId? @unique`, `preferenceId?`; **pago**: `paymentMethod: OrderPaymentMethod?` (`CASH`/`TRANSFER`/`MIXED`), `paymentNote?`, `cashAmount?`/`transferAmount?` (desglose del mixto, suman `total`), `transferConfirmedById?`/`transferConfirmedAt?` (confirmación manual de la transferencia),
`paymentConfirmedById?`/`paymentConfirmedAt?` (cobro TOTAL dado por bueno a mano → `PAID_IN_FULL`,
contraparte manual del webhook de MercadoPago para tenants que cobran en efectivo/transferencia); **entrega**: `fulfillmentMethod: FulfillmentMethod?` (`DELIVERY`/`PICKUP`), `addressText?`, `addressLat?`, `addressLng?`, `addressDetails?`, `addressMapsUrl?` (link de Google Maps, solo se valida el host); **procedencia**: `origin: OrderOrigin=ADMIN`, `contactPhone?`, `contactName?`, `reviewedById?`, `reviewedAt?`; **seña**: `requiresDeposit=false`, `depositAmount?` (snapshot), `depositConfirmedById?`, `depositConfirmedAt?`; `creationContext?`, `createdAt`, `updatedAt` | N-1 user, N-1 tenant, 1-N orderItems, 1-N statusHistory | **Sí** |
| **OrderStatusHistory** | `id`, `orderId`, `fromStatus?`, `toStatus`, `note?`, `changedById?`, `trigger: StatusTrigger=MANUAL` (quién lo movió: persona, motor o webhook), `createdAt` | N-1 order (`onDelete: Cascade`) | **No** (scope vía Order) |
| **OrderPayment** | `id`, `tenantId`, `orderId`, `kind: OrderPaymentKind`, `channel: PaymentChannel`, `amount: Float` (siempre > 0, CHECK en SQL), `note?`, `confirmedById?`, `confirmedAt`, `createdAt` — **libro de cobros: una fila por cobro**. `Order.paymentStatus` se deriva de estas filas (`derivePaymentStatus`, `services/order-state.js`) y la columna queda como cache para poder filtrar por SQL | N-1 order (`onDelete: Cascade`), N-1 tenant | **Sí** |
| **OrderItem** | `id`, `orderId`, `productId` (NOT NULL), `variantId?` (nullable solo para líneas COMBO), `quantity`, `price: Float` (snapshot), `note?`, `parentItemId?` (self-relation, árbol combo, `onDelete: Cascade`) | N-1 order (`onDelete: Cascade`), N-1 product, N-1 variant, self `parentItem`/`childItems` | **No** (scope vía Order) |
| **CashRegisterSession** | `id`, `tenantId`, `status: CashSessionStatus=OPEN`, `openingAmount: Float` (CHECK ≥ 0), `openedById`, `openedAt`, `openingNote?`; cierre (todo null mientras `OPEN`, CHECK de completitud): `closedById?`, `closedAt?`, `closingNote?`, `countedCashAmount?`, `expectedCashAmount?`, `cashDifference?`, `transferTotal?` — **turno de caja física**, no día calendario. Los cuatro totales son un SNAPSHOT del arqueo: no se recalculan nunca | 1-N movements, N-1 tenant (`onDelete: Cascade`) | **Sí** — un solo `OPEN` por tenant, índice único **parcial** solo en la migración |
| **CashMovement** | `id`, `tenantId`, `sessionId`, `type: CashMovementType`, `channel: PaymentChannel` (CHECK `<> GATEWAY`), `amount: Float` (CHECK > 0; el signo lo da `type`), `categoryId?` (null en los `ORDER_*`), `payee?` (texto libre: a quién se le pagó), `orderId?` (**sin FK**, hecho histórico), `orderPaymentId? @unique` (la fila del libro que lo originó → idempotencia estructural del enganche), `note?`, `createdById?`, `createdAt` | N-1 session (`onDelete: Cascade`), N-1 tenant, N-1 opcional `CashCategory` (`onDelete: Restrict`) | **Sí** |
| **CashCategory** | `id`, `tenantId`, `key` (slug estable, no editable), `label` (display), `applies: CashCategoryApplies=EXPENSE`, `position=0`, `isActive=true`, `isSystem=false`, `createdAt`, `updatedAt` — catálogo de etiquetas de movimiento **del tenant** (sueldos, insumos, proveedores…), mismo patrón que `TenantAttribute`. Se siembran 7 al habilitar la caja, más 2 **reservadas** (`venta`/`devolucion`, `isSystem`) que usan los movimientos de orden: solo se pueden renombrar, y no se pueden elegir a mano | 1-N movements, N-1 tenant (`onDelete: Cascade`) | **Sí** (`@@unique([tenantId, key])`) |
| **ContentSuggestion** | `id`, `productId`, `angle: SuggestionAngle`, `status: SuggestionStatus=SUGGESTED`, `source: SuggestionSource=AUTO`, `date @db.Date`, `copy?`, `hashtags: String[]=[]`, `model?`, `generatedAt?`, `createdAt`, `updatedAt` | N-1 tenant, N-1 product, 1-N images (`SuggestionImage`) | **Sí** |
| **SuggestionImage** | `id`, `suggestionId`, `imageUrl`, `imagePublicId`, `options: Json={}` (`{ imagen, infoEnPantalla, precioEnPantalla }`), `model?`, `prompt`, `chosen=false`, `createdAt` | N-1 `ContentSuggestion` (`onDelete: Cascade`), N-1 tenant | **Sí** |
| **TenantPageSpec** | `id`, `tenantId @unique`, `draftSpec: Json?`, `publishedSpec: Json?`, `version=0`, `publishedAt?`, `createdAt`, `updatedAt` — spec del page builder (borrador editable + publicado que sirve el storefront) | 1-1 `Tenant` (`onDelete: Cascade`) | **Sí** (`tenantId @unique`) |

### Constraints / índices únicos relevantes

| Modelo | Constraint |
|---|---|
| Tenant | `slug @unique` |
| TenantConfig | `tenantId @unique`, `whatsappPhoneNumberId @unique`, `@@index([tenantId])` |
| TenantAttribute | `@@unique([tenantId, key])`, `@@index([tenantId])` |
| User | `@@unique([tenantId, username])`, `@@unique([tenantId, email])`, `@@index([tenantId])` |
| UserAddress | `@@unique([userId, label])`, `@@index([tenantId])`, `@@index([userId])` **+ índice único parcial agregado a mano en SQL** para `isDefault = true` (migración `20260727120000_add_user_address` — no declarado en el `.prisma`, ver §11) |
| Categories | `@@unique([tenantId, name])`, `@@index([tenantId])` |
| Product | `@@index([tenantId])` |
| ComboAllowedProduct | `@@unique([comboProductId, allowedProductId])`, `@@index([tenantId])`, `@@index([comboProductId])`, `@@index([comboAllowedCategoryId])` |
| ComboAllowedCategory | `@@unique([comboProductId, categoryId])`, `@@index([tenantId])`, `@@index([comboProductId])`, `@@index([categoryId])` |
| ProductVariant | `@@unique([tenantId, sku])`, `@@index([tenantId])` **+ índice único parcial agregado a mano en SQL** para `isDefault = true` (`ProductVariant_product_default_key`, migración `20260710120000_product_types_collapse_expand` — no declarado en el `.prisma`, ver §11) |
| Promo | `@@index([tenantId])` |
| PromoTier | `@@unique([promoId, minQty])`, `@@index([tenantId])` |
| PromoProduct | `@@unique([promoId, productId])`, `@@index([tenantId])`, `@@index([productId])` (el hot path es "dados estos productIds, su promo activa") |
| Cart | `userId @unique`, `@@unique([tenantId, guestId])` (el `guestId` se escopa por tenant porque el mismo browser puede navegar varios tenants; `userId` ya es único global), `@@index([tenantId])` |
| CartItem | `@@unique([cartId, productId, variantId])` **+ índice único parcial agregado a mano en SQL** para `variantId IS NULL` (`CartItem_cart_product_null_variant_key`, migración `20260708190000_product_types_add` — no declarado en el `.prisma`, ver §11) |
| Order | `mercadoPagoId @unique`, `@@index([tenantId])` |
| OrderStatusHistory | `@@index([orderId])` |
| OrderItem | **sin unique** (el viejo `@@unique([orderId, variantId])` se reemplazó por índices no únicos `@@index([orderId, variantId])`, `@@index([orderId, productId])`, `@@index([parentItemId])` en la migración `20260702214235_order_item_note` — una orden puede tener dos filas del mismo producto/variante con notas distintas) |
| CashRegisterSession | `@@index([tenantId])`, `@@index([tenantId, status])` **+ índice único parcial agregado a mano en SQL** para `status = 'OPEN'` (`CashRegisterSession_tenant_open_key`, migración `20260729223044_add_cash_register` — no declarado en el `.prisma`, ver §11) |
| CashMovement | `orderPaymentId @unique`, `@@index([tenantId])`, `@@index([sessionId])`, `@@index([orderId])`, `@@index([categoryId])` |
| CashCategory | `@@unique([tenantId, key])`, `@@index([tenantId])` |
| ContentSuggestion | `@@unique([tenantId, date, productId, angle])`, `@@index([tenantId])` |
| SuggestionImage | `@@index([tenantId])`, `@@index([suggestionId])` |
| TenantPageSpec | `tenantId @unique`, `@@index([tenantId])` |

### Enums

- `ProductType`: `PRODUCTO`, `COMBO`. Todo `PRODUCTO` tiene siempre ≥1 `ProductVariant` (la
  default, `isDefault=true`) y su precio/stock se leen siempre de ahí — nunca de columnas
  propias de `Product`. `COMBO` usa `Product.price` como precio fijo y no tiene variantes ni
  stock propio (se calcula sobre los componentes elegidos). Colapsado desde el enum original de
  3 valores (`UNIDAD`/`VARIANTE`/`COMBO`) — ver migraciones `..._product_types_collapse_expand`
  / `..._product_types_collapse_contract` más abajo.
- `AttributeType`: `TEXT`, `COLOR` — tipo de valor de un atributo de variante del tenant
  (`TenantAttribute.type`); `COLOR` exige HEX (`#RGB`/`#RRGGBB`) al validar `attributes` de una
  variante, pensado para swatch en el storefront.
- `OrderOrigin`: `ADMIN`, `BOT`, `STORE`. Determina si la orden necesita revisión humana antes de
  producir: todo lo que **no** es `ADMIN` lo cargó un cliente (bot de WhatsApp o storefront) y pasa
  por el guard `ORDER_NOT_REVIEWED`.
- `SuggestionAngle`: `BEST_SELLER`, `NEW_ARRIVAL`, `LOW_STOCK`, `NO_RECENT_SALES`
- `SuggestionStatus`: `SUGGESTED`, `USED`, `DISMISSED`
- `SuggestionSource`: `AUTO`, `MANUAL`
- `OrderStatus`: `PENDING`, `PROCESSING`, `READY`, `COMPLETED`, `CANCELLED` (`READY` = "listo para
  retirar/enviar", paso **opcional**: `PROCESSING → COMPLETED` sigue valiendo). Transiciones y
  precondiciones: `services/order-state.js`
- `StatusTrigger`: `MANUAL`, `AUTO`, `GATEWAY` — quién movió el estado en `OrderStatusHistory`:
  una persona, el motor al cumplirse las condiciones (`applyAutoAdvance`) o el webhook de MercadoPago
- `PaymentStatus`: `PENDING`, `APPROVED`, `REJECTED`, `IN_PROCESS`, `REFUNDED`, `DEPOSIT_PAID`,
  `PAID_IN_FULL`. **No se escribe a mano: lo deriva `derivePaymentStatus` desde el libro de cobros**
  y la columna queda como cache para poder filtrar por SQL. `REFUNDED` sale de una devolución que
  cancela todo lo cobrado (ver §11 por la devolución parcial).
- `FulfillmentMethod`: `DELIVERY`, `PICKUP` — cómo se entrega la orden. Los campos `addressX` de
  `Order` solo son relevantes con `DELIVERY`.
- `OrderPaymentMethod`: `CASH`, `TRANSFER`, `MIXED` — forma de pago acordada. Con `MIXED`,
  `cashAmount` + `transferAmount` suman `total`.
- `PaymentChannel`: `CASH`, `TRANSFER`, `GATEWAY` — vía por la que entró **un cobro concreto**
  (`OrderPayment.channel`). No es lo mismo que `OrderPaymentMethod`: una orden `MIXED` produce dos
  filas, una `CASH` y una `TRANSFER`; `MIXED` no existe como canal. `GATEWAY` es MercadoPago, y esa
  plata nunca pasa por el mostrador.
- `OrderPaymentKind`: `DEPOSIT`, `PAYMENT`, `REFUND` — qué representa la fila. El signo no se
  guarda: lo aporta `PAYMENT_SIGN` y `amount` es siempre positivo.
- `CashSessionStatus`: `OPEN`, `CLOSED` — turno de caja. Un solo `OPEN` por tenant, garantizado por
  índice único parcial.
- `CashMovementType`: `ORDER_DEPOSIT`, `ORDER_PAYMENT`, `ORDER_REFUND`, `INCOME`, `EXPENSE`. Los tres
  primeros los escribe solo el enganche con el libro de cobros (uno por fila que no sea `GATEWAY`);
  los dos últimos son los manuales del local (sueldos, insumos, retiros). El signo lo aporta
  `CASH_MOVEMENT_SIGN` (`services/cash-register-math.js`) y `amount` es siempre positivo.
- `CashCategoryApplies`: `INCOME`, `EXPENSE`, `BOTH` — a qué dirección aplica una etiqueta de caja
  ("Sueldos" no es un ingreso jamás).
- `CashSessionTrigger`: `MANUAL`, `AUTO` — quién abrió el turno de caja (una persona o el horario del
  tenant). "Vencido" **no** es un estado: se deriva de `expiresAt < now` sobre un turno `OPEN`, así no
  hace falta ningún job que lo escriba.
- `Role`: `ADMIN`, `STAFF`, `CUSTOMER`

### Migraciones

49 migraciones en `prisma/migrations/` (cronológicas):

`..._initial_multi_tenant`, `..._email_global_unique`, `..._email_verification`,
`..._add_tenant_config`, `..._add_product_price`, `..._expand_roles_storefront`,
`..._variant_price_optional`, `..._add_order_status_history`, `..._add_content_suggestions`,
`..._product_price_required`, `..._suggestions_multi_source`, `..._add_suggestion_status`,
`..._add_whatsapp_phone_number_id`, `..._add_whatsapp_access_token`, `..._add_order_deposit`
(seña + `userId` nullable + `origin` BOT), `20260622004619` (sin nombre descriptivo),
`..._add_suggestion_image`, `..._add_tenant_page_spec`, `..._add_category_image_url`,
`..._add_category_img_public_id`, `..._order_item_note`,
`..._product_variants_enabled_flag`, `..._combos` (`ComboAllowedProduct` +
`isCombo`/`comboMin/MaxItems` + `CartItem.comboSelection` + `OrderItem.parentItemId`),
`..._product_types_add` (fase *expand*, primera ronda: enum `ProductType` nullable,
`Product.stock`, `productId` en `CartItem`/`OrderItem`, `variantId` nullable), `..._product_types_harden`
(fase *contract*, primera ronda: `Product.type`/`OrderItem.productId`/`CartItem.productId` pasan a
NOT NULL — en esta ronda el enum todavía tenía 3 valores, `UNIDAD`/`VARIANTE`/`COMBO`),
`20260709033159_add_combo_allowed_category` (`ComboAllowedCategory`, whitelist de combos por
categoría entera), `20260710120000_product_types_collapse_expand` (fase *expand* del colapso a 2
tipos: agrega el valor de enum `PRODUCTO`, columna `ProductVariant.isDefault` + su índice único
parcial), `20260710123000_product_types_collapse_contract` (fase *contract*: colapsa el enum a
`PRODUCTO`/`COMBO` reescribiendo `UNIDAD`→`PRODUCTO` y `VARIANTE`→`PRODUCTO`, `Product.price` pasa
a nullable, `Product.stock` se elimina, `ProductVariant.price` pasa a NOT NULL). El backfill de
datos entre esas dos migraciones (asignar `isDefault` y crear/completar variantes) lo hace
`prisma/migrate-collapse-product-types.js`, corrido a mano una vez por entorno — no es una
migración SQL. `20260710150000_combo_category_members` (FK nullable
`ComboAllowedProduct.comboAllowedCategoryId` → miembros explícitos de una regla de categoría;
sin backfill, las filas existentes quedan null = standalone legacy).
`20260711193049_variant_flexible_attributes` (generaliza `ProductVariant.color`/`size` a
`attributes JSONB` + tabla `TenantAttribute` — catálogo one-time de atributos por tenant; a
diferencia del colapso de tipos, el backfill es SQL puro y va **dentro de la misma migración**:
color→`attributes.color`, size→`attributes.talle`, y crea el catálogo color/talle para los tenants
que ya usaban esas columnas antes de dropearlas).
`20260713222206_product_delete_cascade_content_suggestions_cart`,
`20260720120000_cart_guest_support` (carrito de invitado por cookie, `Cart.guestId`),
`20260720130000_add_category_position` (orden de display de categorías),
`20260723001137_order_fulfillment_and_payment_method` (entrega + forma de pago: enums
`FulfillmentMethod`/`OrderPaymentMethod`, campos de dirección, `paymentNote`, confirmación manual de
transferencia; `Order.paymentMethod` pasó de `String?` libre a enum tipado — destructivo, pero solo
contenía placeholders de seed), `20260723022006_add_promos` (descuento por cantidad),
`20260726104943_order_checkout_whatsapp` (`Order.addressMapsUrl` para el link de Google Maps,
`cashAmount`/`transferAmount` para el desglose del pago mixto, y el valor `STORE` en el enum
`OrderOrigin` — puramente aditiva, sin backfill: las órdenes de storefront anteriores quedan como
`ADMIN` y no se les exige revisión retroactiva),
`20260727120000_add_user_address` (libreta de direcciones `UserAddress` + índice único **parcial**
para `isDefault = true`, que vive solo en el SQL de la migración; sin FK desde `Order` a propósito),
`20260728100000_add_tenant_theme` / `20260728160000_add_tenant_theme_weights` /
`20260728190000_add_tenant_theme_sections` (tema de la tienda editable por el tenant: acento, radio,
fuentes, pesos por rol y overrides por sección en `TenantConfig.themeSections` JSON),
`20260728181921_add_order_payment_confirmation` (`Order.paymentConfirmedById`/`paymentConfirmedAt`
para el cobro total manual), `20260729120000_add_customer_phone` (`User.phone` +
`TenantConfig.customerPhoneMode`/`Country`/`Area`, con CHECK sobre los valores del modo),
`20260729140000_order_state_engine` (valor `READY` en `OrderStatus` —insertado `BEFORE 'COMPLETED'`
para que el enum conserve el orden lógico del flujo— + enum `StatusTrigger` y
`OrderStatusHistory.trigger`, que nace en `MANUAL` porque hasta acá el único camino era el PATCH),
`20260729180000_add_order_payments` (libro de cobros `OrderPayment` + enums `PaymentChannel`/
`OrderPaymentKind` + `CHECK amount > 0`, **con backfill**: reconstruye una fila por cada sello
existente —seña, transferencia, cobro total, aprobación de MercadoPago— en cuatro INSERT donde cada
uno descuenta lo que los anteriores ya registraron para esa orden. `paymentStatus` **no** se
recalcula en la migración: las órdenes viejas conservan el valor que tenían, así el deploy no mueve
ningún estado de pago),
`20260729212531_add_tenant_order_flow` (`TenantConfig.paymentMethodsEnabled`/
`fulfillmentMethodsEnabled` como arrays de enum con `@default` — los defaults reproducen el
comportamiento anterior, así que ningún tenant existente cambia),
`20260729223044_add_cash_register` (módulo de caja: `CashRegisterSession`, `CashMovement`,
`CashCategory` + enums `CashSessionStatus`/`CashMovementType`/`CashCategoryApplies` +
`TenantConfig.cashRegisterEnabled=false`. Aditiva, sin backfill. Lo agregado **a mano** al SQL
generado: el índice único **parcial** de un solo turno `OPEN` por tenant, y cuatro CHECK —
`amount > 0`, `channel <> 'GATEWAY'`, `openingAmount >= 0`, y la completitud del cierre
`status=CLOSED ⇔ closedAt & countedCashAmount`),
`20260730044307_cash_session_schedule` (turnos con horario: `TenantConfig.cashSchedule` JSON, enum
`CashSessionTrigger`, y `trigger`/`label`/`expiresAt`/`closedWithoutCount` en `CashRegisterSession`. El
CHECK de completitud del cierre se **reemplaza** para admitir el turno cerrado sin conteo — sigue
prohibiendo el caso que importa, un `CLOSED` sin arqueo y sin declararlo),
`20260730044550_cash_session_auto_opener` (`CashRegisterSession.openedById` pasa a nullable: una
apertura automática no tiene persona detrás),
`20260730053400_cash_system_categories` (`CashCategory.isSystem` + **backfill**: siembra las etiquetas
reservadas `venta`/`devolucion` por tenant y les asigna los movimientos de orden que ya existían, que
hasta acá entraban con `categoryId NULL` y dejaban las ventas afuera del eje de etiquetas).

---

## 4. Multi-tenancy

Hay **dos mecanismos distintos** de resolución de tenant según la familia de rutas:

### A. API de administración (`/orders`, `/products`, `/stats`, `/content-suggestions`, …)
- El `tenantId` proviene **del JWT**. `verifyToken` (`middleware/auth.js`) decodifica la
  cookie `access_token`, exige `decoded.tenantId` (si falta → 401 "Token sin tenant") y
  setea `req.tenantId = decoded.tenantId`.
- No hay lookup de tenant en DB en este camino: se confía en el claim del token.

### B. API storefront (`/store/*`)
- `resolveTenantFromSlug` (`middleware/tenant.js`), montado globalmente en
  `routes/store/index.js` antes de las sub-rutas. Resuelve el **slug** desde:
  1. **Subdominio** del host (`extractSlugFromHost`): toma el primer label del hostname,
     ignora hosts locales (`localhost`, `127.0.0.1`, `::1`, `0.0.0.0`) y subdominios
     `www`/`api`/`app`; requiere ≥3 labels.
  2. Header **`X-Tenant-Slug`** (fallback).
- Con el slug busca el `Tenant` en DB (`select id, slug, name, isActive`); si no existe →
  404 `TENANT_NOT_FOUND`, si está inactivo → 403 `TENANT_INACTIVE`. Setea
  `req.tenantId`, `req.tenantSlug` y `req.tenant`.
- (Existe también `resolveTenantSlug`, que solo setea `req.tenantSlug` sin tocar la DB; no
  se observa montado en los routers actuales.)

### Inyección del scope en queries
- **No hay extensión/middleware de Prisma que filtre por tenant automáticamente.** El
  scoping es **manual**: cada método de service agrega `tenantId` en el `where` (p. ej.
  `prisma.product.findFirst({ where: { id, tenantId } })`). Los controllers pasan
  `req.tenantId` explícito a cada método del service. Ver §11 (riesgo).

---

## 5. Autenticación

> [!important] En producción, hoy, casi nadie se autentica (2026-07-29)
> Decisión de producto, no del código: el primer cliente en producción opera **sin cuentas de
> cliente** (todo el storefront va por el camino de invitado, porque login/registro antes de comprar
> hace abandonar pedidos) y **sin autoservicio para administradores** (las credenciales del
> backoffice se entregan a mano, una por una). Todo lo de esta sección sigue implementado y
> funcionando; lo que cambia es qué se usa. Ver [[Usuarios y Auth]], y el plan de integración en
> [[Producción sin cuentas (propuesta)]].

### Emisión del JWT
- Se firma con `DEFAULTS.SECRET_JWT_KEY`, `expiresIn: "8h"`.
- **Payload idéntico** en admin (`controllers/users.js → login`) y storefront
  (`controllers/store/auth.js → login`):
  `{ id, username, role, email, tenantId }`.

### Transporte del token (asimétrico admin vs store)
- **Admin**: el token se devuelve en una **cookie** `access_token`
  (`httpOnly: true`, `sameSite: "strict"`, `secure: NODE_ENV==="production"`,
  `maxAge: 8h`). `verifyToken` **lee solo la cookie** (`req.cookies.access_token`).
- **Store**: el login **no setea cookie**; devuelve el `token` en el **body** de la
  respuesta para usarse como `Authorization: Bearer <token>`.

### Validación
- `verifyToken` (admin): cookie obligatoria; exige `tenantId` en el token.
- `attachUser` (admin, auth opcional): si hay cookie válida setea `req.user`/`req.tenantId`,
  si no, ambos `null`.
- `verifyStoreToken` (store): `extractToken` acepta **Bearer o cookie**; además valida que
  `decoded.tenantId === req.tenantId` (el tenant resuelto por slug), si no → 403.
- `optionalStoreAuth` (store): igual que el anterior pero no obliga; setea `req.user=null`
  si no hay/no coincide el token.
- Roles: `requireRole(allowedRoles)` (`middleware/role.js`) compara `req.user.role` contra
  la lista permitida (401 si no hay user, 403 si el rol no aplica).

### Passwords y verificación de email
- Passwords con **argon2** (`helpers/password.js`: `hashPassword`/`verifyPassword`).
- Verificación de email: `lib/tokens.js` genera un token aleatorio (`randomBytes(32)` hex),
  guarda su **hash sha256** (`emailVerificationTokenHash`) y un `expiresAt` (TTL **24 h**,
  `EMAIL_VERIFICATION_TTL_MS`). El email se envía con `lib/mailer.js` (nodemailer).
- `login`/`loginForTenant` **exigen `emailVerified === true`** (si no → 403
  `EMAIL_NOT_VERIFIED`). El registro admin crea `Tenant` + `User(role=ADMIN)` en una
  transacción; el registro store crea `User(role=CUSTOMER)` en el tenant resuelto.

---

## 6. API — Endpoints

Prefijos de montaje (de `app.js`): `/webhooks/whatsapp` (antes del parser JSON global), `/orders`,
`/products`, `/variants`, `/categories`, `/promos`, `/cart`, `/users`, `/mercadopago`, `/stats`,
`/content-suggestions`, `/page-spec`, `/auth`, `/test`, `/tenant-config`, `/tenant-attributes`,
`/store`. Más `GET /health` inline (200 `{ status: "ok" }`, sin auth — lo usa el healthcheck del
contenedor).

Convenciones de middleware citadas: `verifyToken` (cookie admin), `requireRole([...])`,
`validate({ body|params|query })` (zod; `query` validada queda en `req.search`),
`uploadImage` + `normalizeMultipartBody` (multer/cloudinary), limiters de `rateLimit.js`.

### `/auth` (admin) — `routes/users.js`

| Método | Ruta | Middleware | Controller → Service |
|---|---|---|---|
| POST | `/auth/register` | `registerLimiter`, `validate(body)` | `usersController.register` → `UserModel.register` |
| POST | `/auth/login` | `loginLimiter`, `validate(body)` | `usersController.login` → `UserModel.login` (firma JWT, set cookie) |
| POST | `/auth/logout` | — | `usersController.logout` (clear cookie) |
| GET | `/auth/me` | `verifyToken` | `usersController.me` → `UserModel.me` |
| GET | `/auth/verify-email` | `validate(query)` | `usersController.verifyEmail` → `UserModel.verifyEmail` |
| POST | `/auth/resend-verification` | `validate(body)` | `usersController.resendVerification` → `UserModel.resendVerification` |

### `/orders` (admin) — `routes/orders.js`

| Método | Ruta | Middleware | Controller → Service |
|---|---|---|---|
| POST | `/orders` | `verifyToken`, `validate(body: orderCreate)` | `OrderController.create` → `OrderModel.create` (`origin: ADMIN`) |
| GET | `/orders` | `verifyToken`, `validate(query)` | `OrderController.getAll` → `OrderModel.getAll` |
| GET | `/orders/all` | `verifyToken`, `requireRole(["ADMIN","STAFF"])`, `validate(query)` | `OrderController.getUserOrders` → `OrderModel.getUserOrders` |
| GET | `/orders/:id` | `verifyToken`, `validate(params)` | `OrderController.getById` → `OrderModel.getUserOrderById` |
| PATCH | `/orders/:id` | `verifyToken`, `requireRole(["ADMIN","STAFF"])`, `validate(params,body)` | `OrderController.update` → `OrderModel.updateOrderStatus` (transiciones y precondiciones: `services/order-state.js`) |
| POST | `/orders/:id/review` | `verifyToken`, `requireRole(["ADMIN","STAFF"])`, `validate(params, body: orderReview)` | `OrderController.review` → `OrderModel.reviewOrder` (marca revisado un pedido BOT o STORE; corrección inline opcional de cantidades/notas y de los datos de entrega/pago. **Puede dejar la orden ya en `PROCESSING`**: avance automático) |
| POST | `/orders/:id/confirm-deposit` | `verifyToken`, `requireRole(["ADMIN","STAFF"])`, `validate(params, body: orderConfirmDeposit)` | `OrderController.confirmDeposit` → `OrderModel.confirmDeposit` (`paymentStatus → DEPOSIT_PAID`) |
| POST | `/orders/:id/confirm-transfer` | `verifyToken`, `requireRole(["ADMIN","STAFF"])`, `validate(params, body: orderConfirmTransfer)` | `OrderController.confirmTransfer` → `OrderModel.confirmTransfer` (sella `transferConfirmedById`/`At`) |
| POST | `/orders/:id/confirm-payment` | `verifyToken`, `requireRole(["ADMIN","STAFF"])`, `validate(params, body: orderConfirmPayment)` | `OrderController.confirmPayment` → `OrderModel.confirmPayment` (`paymentStatus → PAID_IN_FULL`; solo desde `PENDING`/`DEPOSIT_PAID`) |

| POST | `/orders/:id/payments` | `verifyToken`, `requireRole(["ADMIN","STAFF"])`, `validate(params, body: orderPaymentCreate)` | `OrderController.registerPayment` → `OrderModel.registerPayment` (alta en el libro de cobros: `{ kind, channel, amount, note? }`) |
| GET | `/orders/:id/payments` | `verifyToken`, `requireRole(["ADMIN","STAFF"])`, `validate(params)` | `OrderController.getPayments` → `OrderModel.getPayments` (libro + resumen + pendiente por vía) |

> Las tres confirmaciones de cobro **no mueven `status` por sí mismas**, pero desde 2026-07-29 pueden
> destrabar el avance automático a `PROCESSING` (`applyAutoAdvance`) si con ese cobro la orden queda
> sin blockers. Todas las respuestas de órdenes del backoffice traen `blockers`, `canProduce` y
> `payment` — ver [[Órdenes]] §Máquina de estados.
>
> Y las tres son **atajos sobre `/payments`**: calculan el monto (la seña, lo que falte por
> transferencia, el saldo por vía) y escriben en el mismo libro de cobros. `paymentStatus` ya no lo
> escribe nadie a mano — se deriva de esas filas.

### `/products` (admin) — `routes/productos.js`

| Método | Ruta | Middleware | Controller → Service |
|---|---|---|---|
| GET | `/products` | `verifyToken`, `validate(query)` | `productsController.getAll` → `ProductModel.getAll` |
| GET | `/products/options` | `verifyToken` | `productsController.getVariantOptions` → `ProductModel.getVariantOptions` |
| GET | `/products/stats` | `verifyToken`, `requireRole(["ADMIN","STAFF"])` | `productsController.getStats` → `ProductModel.getStats` |
| GET | `/products/:id` | `verifyToken`, `validate(params)` | `productsController.getById` → `ProductModel.getById` |
| GET | `/products/:id/combo-options` | `verifyToken`, `validate(params)` | `productsController.getComboOptions` → `ProductModel.getComboOptions` (whitelist de componentes + stock por tipo) |
| POST | `/products` | `verifyToken`, `requireRole(["ADMIN","STAFF"])`, `uploadImage`, `normalizeMultipartBody`, `validate(body)` | `productsController.create` → `ProductModel.create` (rama por `type`: PRODUCTO/COMBO) |
| PATCH | `/products/:id/category` | `verifyToken`, `requireRole(["ADMIN","STAFF"])`, `validate(params,body)` | `productsController.assignCategory` → `ProductModel.assignCategory` |
| PATCH | `/products/:id` | `verifyToken`, `requireRole(["ADMIN","STAFF"])`, `uploadImage`, `normalizeMultipartBody`, `requireBodyOrImage`, `validate(params,body)` | `productsController.edit` → `ProductModel.edit` |
| DELETE | `/products/:id` | `verifyToken`, `requireRole(["ADMIN","STAFF"])`, `validate(params)` | `productsController.delete` → `ProductModel.delete` |

### `/variants` (admin) — `routes/variants.js`

| Método | Ruta | Middleware | Controller → Service |
|---|---|---|---|
| GET | `/variants/:productId` | `verifyToken`, `requireRole(["ADMIN","STAFF"])`, `validate(params)` | `variantsController.getAll` → `VariantModel.getVariants` |
| POST | `/variants/:productId` | `verifyToken`, `requireRole(["ADMIN","STAFF"])`, `uploadImage`, `normalizeMultipartBody`, `validate(params,body)` | `variantsController.create` → `VariantModel.createVariant` |
| PATCH | `/variants/:productId/:id` | `verifyToken`, `requireRole(["ADMIN","STAFF"])`, `uploadImage`, `normalizeMultipartBody`, `requireBodyOrImage`, `validate(params,body)` | `variantsController.edit` → `VariantModel.editVariant` |
| DELETE | `/variants/:productId/:id` | `verifyToken`, `requireRole(["ADMIN","STAFF"])`, `validate(params)` | `variantsController.delete` → `VariantModel.deleteVariant` |

### `/categories` (admin) — `routes/categories.js`

| Método | Ruta | Middleware | Controller → Service |
|---|---|---|---|
| GET | `/categories` | `verifyToken` | `CategoryController.getAll` → `CategoryModel.getAll` |
| GET | `/categories/tree` | `verifyToken` | `CategoryController.getTree` → `CategoryModel.getTree` |
| GET | `/categories/:id` | `verifyToken`, `validate(params)` | `CategoryController.getById` → `CategoryModel.getById` |
| POST | `/categories` | `verifyToken`, `requireRole(["ADMIN","STAFF"])`, `validate(body)` | `CategoryController.create` → `CategoryModel.create` |
| PATCH | `/categories/:id` | `verifyToken`, `requireRole(["ADMIN","STAFF"])`, `validate(params,body)` | `CategoryController.edit` → `CategoryModel.edit` |
| DELETE | `/categories/:id` | `verifyToken`, `requireRole(["ADMIN","STAFF"])`, `validate(params)` | `CategoryController.delete` → `CategoryModel.delete` |

### `/promos` (admin) — `routes/promos.js`

Descuento por cantidad (escalones `minQty` → `discountPercentage`) aplicado sobre los productos
asociados a la promo. Se aplica al pricear el carrito/la orden.

| Método | Ruta | Middleware | Controller → Service |
|---|---|---|---|
| GET | `/promos` | `verifyToken`, `validate(query: promoQuery)` | `PromoController.getAll` → `PromoModel.getAll` |
| GET | `/promos/:id` | `verifyToken`, `validate(params)` | `PromoController.getById` → `PromoModel.getById` |
| POST | `/promos` | `verifyToken`, `requireRole(["ADMIN","STAFF"])`, `validate(body: createPromo)` | `PromoController.create` → `PromoModel.create` |
| PATCH | `/promos/:id` | `verifyToken`, `requireRole(["ADMIN","STAFF"])`, `validate(params, body: updatePromo)` | `PromoController.edit` → `PromoModel.edit` |
| DELETE | `/promos/:id` | `verifyToken`, `requireRole(["ADMIN","STAFF"])`, `validate(params)` | `PromoController.delete` → `PromoModel.delete` |

### `/cart` (admin) — `routes/cart.js`

| Método | Ruta | Middleware | Controller → Service |
|---|---|---|---|
| GET | `/cart` | `verifyToken` | `cartController.getCart` → `CartModel.getCart` |
| POST | `/cart/combo/:productId` | `verifyToken`, `validate(params, body: comboSelectionBody)` | `cartController.addCombo` → `CartModel.addCombo` (valida selección vía `services/combos.js`) — montada antes del `POST /:productId` genérico |
| POST | `/cart/:productId` | `verifyToken`, `validate(params, body)` | `cartController.add` → `CartModel.add` |
| PATCH | `/cart/:productId` | `verifyToken`, `validate(params)` | `cartController.remove` → `CartModel.remove` |
| DELETE | `/cart` | `verifyToken` | `cartController.clear` → `CartModel.clear` |

> Nota: las rutas de `/cart` cambiaron de `:variantId` a `:productId` (breaking change, ver
> [[Carrito]]) — un ítem de carrito ahora se identifica por producto (+ variante si aplica).

### `/users` (admin) — `routes/role.js`

| Método | Ruta | Middleware | Controller → Service |
|---|---|---|---|
| PATCH | `/users/:id` | `verifyToken`, `requireRole(["ADMIN"])`, `validate(params,body)` | `roleController.edit` → `roleModel.edit` |

### `/mercadopago` — `routes/mercadopago.js`

| Método | Ruta | Middleware | Handler |
|---|---|---|---|
| GET | `/mercadopago/success` | — | inline (200, texto; loguea query) |
| GET | `/mercadopago/failure` | — | inline (200, texto) |
| GET | `/mercadopago/pending` | — | inline (200, texto) |
| POST | `/mercadopago/webhook` | `webhookLimiter` | `mercadopagoController.getWebhook` |
| POST | `/mercadopago/:id` | `verifyToken`, `validate(params: validateId)` | `mercadopagoController.create` |

### `/stats` (admin) — `routes/stats.js`

| Método | Ruta | Middleware | Controller → Service |
|---|---|---|---|
| GET | `/stats/dashboard` | `verifyToken`, `requireRole(["ADMIN","STAFF"])`, `validate(query: StatsQuery)` | `StatsController.get` → `StatsModel.getDashboard` |

Además de KPIs/gráficos/ranking, el dashboard devuelve desde 2026-07-30 **`cobranzas`** (facturado vs
cobrado, la brecha entre los dos, y el desglose por vía desde `OrderPayment`) y **`caja`** (turnos,
egresos por etiqueta, diferencia de arqueo acumulada y un resultado aproximado; `null` si el tenant no
tiene el módulo). Las dos ventanas son distintas a propósito y están declaradas en `meta.criteria`:
los cobros se cuentan por `confirmedAt`, y los turnos de caja **enteros** por `openedAt` — un turno
noche que cierra a las 2 AM cuenta en el día que abrió y no se parte, porque así lo nombra el negocio.
Ver [[Estadísticas]] y [[Caja]].

### `/cash-register` (admin) — `routes/cash-register.js`

Todo el router con `verifyToken`; operar el turno pide `["ADMIN","STAFF"]`, configurar el catálogo de
etiquetas solo `["ADMIN"]`. **Si el tenant no tiene `cashRegisterEnabled`, todos responden 404
`CASH_REGISTER_DISABLED`.** Las rutas de nombre fijo se declaran antes de `/:id` o `validateId` las
rechaza.

| Método | Ruta | Validación | Controller → Service |
|---|---|---|---|
| GET | `/cash-register/current` | — | `current` → `CashRegisterModel.getCurrent` (200 con `session: null` si no hay turno abierto) |
| POST | `/cash-register/open` | `body: openCashSession` | `open` → `open` (409 `CASH_SESSION_ALREADY_OPEN`) |
| POST | `/cash-register/close` | `body: closeCashSession` | `close` → `close` (devuelve el arqueo) |
| POST | `/cash-register/movements` | `body: createCashMovement` | `addMovement` → `addMovement` (solo `INCOME`/`EXPENSE`; etiqueta obligatoria) |
| GET | `/cash-register/summary` | `query: cashSummaryQuery` | `summary` → `getSummary` (totales por etiqueta/tipo/vía en un rango) |
| GET | `/cash-register/categories` | `query: cashCategoryQuery` | `listCategories` → `listCategories` |
| POST | `/cash-register/categories` | `body: createCashCategory` | `createCategory` (ADMIN) |
| PATCH | `/cash-register/categories/:id` | `params: validateId`, `body: updateCashCategory` | `updateCategory` (ADMIN; `key` no editable) |
| DELETE | `/cash-register/categories/:id` | `params: validateId` | `deleteCategory` (ADMIN; 409 `CASH_CATEGORY_IN_USE` si tiene movimientos) |
| GET | `/cash-register` | `query: cashSessionQuery` | `getAll` → `getAll` (historial, `limit` ≤ 100) |
| GET | `/cash-register/:id` | `params: validateId` | `getById` → `getById` |
| GET | `/cash-register/:id/export` | `params: validateId` | `exportSession` → `exportSession` — responde un `.xlsx` binario (`Content-Disposition: attachment`), no JSON |
| GET | `/cash-register/export` | `query: cashSummaryQuery` | `exportPeriod` → `exportPeriod` — el período entero en `.xlsx` (un renglón por turno + todos los movimientos) |

### `/content-suggestions` (admin) — `routes/content-suggestions.js`

Todas con `verifyToken` + `requireRole(["ADMIN","STAFF"])`.

| Método | Ruta | Validación | Controller → Service |
|---|---|---|---|
| GET | `/content-suggestions` | `validate(query: suggestionRangeQuery)` (range 7\|15\|30, default 7) | `ContentSuggestionController.getRange` → `ContentSuggestionModel.getRange` |
| GET | `/content-suggestions/today` | — | `getToday` → `ContentSuggestionModel.getToday` |
| GET | `/content-suggestions/products/:productId/angles` | `validate(params: productIdParam)` | `getProductAngles` → `ContentSuggestionModel.getProductAngles` |
| POST | `/content-suggestions/products/:productId/generate` | `validate(params, body: generateBody)` | `generateForProduct` → `ContentSuggestionModel.generateForProduct` |
| POST | `/content-suggestions/refine` | `validate(body: refineBody)` | `refineProductCopy` → `ContentSuggestionModel.refineProductCopy` |

### `/tenant-config` — `routes/tenant-config.js`

| Método | Ruta | Middleware | Controller → Service |
|---|---|---|---|
| GET | `/tenant-config/:tenantId` | `attachUser`, `validate(params)` | `TenantConfigController.get` → `TenantConfigModel.get` |
| PATCH | `/tenant-config/:tenantId` | `verifyToken`, `requireRole(["ADMIN"])`, `validate(params,body)` | `TenantConfigController.update` → `TenantConfigModel.update` |
| PATCH | `/tenant-config/:tenantId/logo` | `verifyToken`, `requireRole(["ADMIN"])`, `uploadImage`, `normalizeMultipartBody`, `validate(params)` | `TenantConfigController.uploadLogo` → `TenantConfigModel.uploadLogo` |
| DELETE | `/tenant-config/:tenantId/logo` | `verifyToken`, `requireRole(["ADMIN"])`, `validate(params)` | `TenantConfigController.deleteLogo` → `TenantConfigModel.deleteLogo` |

> [!important] El flujo de venta no se edita por esta ruta (2026-07-29)
> `paymentMethodsEnabled`, `fulfillmentMethodsEnabled`, `depositEnabled` y `depositPercentage`
> **se leen** en el `GET` (el storefront los necesita para pintar el checkout) pero el `PATCH` los
> rechaza con 400. Deciden cuándo una orden puede producirse y cuánta plata se exige antes, así que
> los configuramos nosotros: si el tenant los cambiara, podría trabar pedidos ya en curso.
>
> El mecanismo es que el campo **no está en `updateTenantConfigObject`**
> (`READONLY_TENANT_CONFIG_FIELDS` en `schemas/tenant-config.schema.js`), no un chequeo de rol: el
> `requireRole(["ADMIN"])` de esta ruta es el admin *del propio tenant*. Se setean con un perfil al
> crear el tenant y después con `node prisma/set-tenant-profile.js <slug> <perfil>`. Ver
> [[TenantConfig]].

### `/tenant-attributes` — `routes/tenant-attributes.js`

Catálogo de atributos de variante del tenant (ver [[Variantes]] en `docs/servicios/dominio/`). El
`PUT` es un **setup one-time**: `409 ATTRIBUTES_ALREADY_SET` si el catálogo ya existe — no hay
edición posterior por API (cambiarlo rompería las `attributes` de las variantes existentes).

| Método | Ruta | Middleware | Controller → Service |
|---|---|---|---|
| GET | `/tenant-attributes/:tenantId` | `attachUser`, `validate(params)` | `TenantAttributeController.get` → `TenantAttributeModel.get` |
| PUT | `/tenant-attributes/:tenantId` | `verifyToken`, `requireRole(["ADMIN"])`, `validate(params,body)` | `TenantAttributeController.setup` → `TenantAttributeModel.setup` |

### `/test` — `routes/test.js`

| Método | Ruta | Middleware | Handler |
|---|---|---|---|
| GET | `/test/:id` | `verifyToken`, `requireRole(["ADMIN"])` | inline: devuelve `{ id, username, role }` del token (ruta de prueba/debug, ver §11) |

### Storefront `/store/*`

Montaje en `routes/store/index.js`: **todo `/store/*` aplica `storeCors()` + `storeCacheHeaders` +
`resolveTenantFromSlug`** antes de las sub-rutas. Auth = `verifyStoreToken` (obligatoria,
Bearer/cookie) u `optionalStoreAuth` (pública con user opcional).

`storeCacheHeaders` fuerza `Cache-Control: no-store` y appendea `Vary: X-Tenant-Slug` +
`Vary: Authorization`: el tenant viaja por header, no por URL, así que un cache compartido que
indexe solo por URL le serviría el catálogo de un tenant a otro (`middleware/storeCache.js`).

**`/store/auth`** — `routes/store/auth.js`

| Método | Ruta | Middleware | Controller → Service |
|---|---|---|---|
| POST | `/store/auth/register` | `registerLimiter`, `validate(body)` | `StoreAuthController.register` → `UserModel.registerCustomer` |
| POST | `/store/auth/login` | `loginLimiter`, `validate(body)` | `StoreAuthController.login` → `UserModel.loginForTenant` (devuelve token en body) |
| POST | `/store/auth/logout` | — | `StoreAuthController.logout` |
| GET | `/store/auth/me` | `verifyStoreToken` | `StoreAuthController.me` (lee `req.user`) |
| GET | `/store/auth/verify-email` | `validate(query)` | `StoreAuthController.verifyEmail` → `UserModel.verifyEmail` |
| POST | `/store/auth/resend-verification` | `validate(body)` | `StoreAuthController.resendVerification` → `UserModel.resendVerification` |

**`/store/products`** — `routes/store/products.js` (lectura pública)

| Método | Ruta | Middleware | Controller → Service |
|---|---|---|---|
| GET | `/store/products` | `optionalStoreAuth`, `validate(query)` | `StoreProductsController.getAll` → `ProductModel.getAll` |
| GET | `/store/products/options` | `optionalStoreAuth` | `StoreProductsController.getVariantOptions` → `ProductModel.getVariantOptions` |
| GET | `/store/products/:id` | `optionalStoreAuth`, `validate(params)` | `StoreProductsController.getById` → `ProductModel.getById` |
| GET | `/store/products/:id/combo-options` | `optionalStoreAuth`, `validate(params)` | `StoreProductsController.getComboOptions` → `ProductModel.getComboOptions` |

**`/store/categories`** — `routes/store/categories.js` (lectura pública)

| Método | Ruta | Middleware | Controller → Service |
|---|---|---|---|
| GET | `/store/categories` | `optionalStoreAuth` | `StoreCategoriesController.getAll` → `CategoryModel.getAll` |
| GET | `/store/categories/tree` | `optionalStoreAuth` | `StoreCategoriesController.getTree` → `CategoryModel.getTree` |
| GET | `/store/categories/:id` | `optionalStoreAuth`, `validate(params)` | `StoreCategoriesController.getById` → `CategoryModel.getById` |

**`/store/cart`** — `routes/store/cart.js` (reusa `cartController`)

**Sin login.** Todo el router aplica `optionalStoreAuth` + `resolveCartOwner`: con token el dueño del
carrito es `{ userId }`, sin token es `{ guestId }` — un UUID en la cookie httpOnly `guest_cart_id`
(`path=/store`, 30 días, `SameSite=None; Secure` en producción porque el storefront puede vivir en
otro dominio). Al loguearse, `StoreAuthController.login` fusiona el carrito de invitado en el del
usuario (`CartModel.mergeGuestCartIntoUser`) y borra la cookie; si el merge falla, se loguea el error
y el login sigue adelante.

| Método | Ruta | Middleware | Controller → Service |
|---|---|---|---|
| GET | `/store/cart` | `optionalStoreAuth`, `resolveCartOwner` | `cartController.getCart` → `CartModel.getCart` |
| POST | `/store/cart/combo/:productId` | idem + `validate(params, body: comboSelectionBody)` | `cartController.addCombo` → `CartModel.addCombo` — montada **antes** del `POST /:productId` genérico |
| POST | `/store/cart/:productId` | idem + `validate(params, body: cartItemBody)` | `cartController.add` → `CartModel.add` |
| PATCH | `/store/cart/:productId` | idem + `validate(params, body: cartItemBody)` | `cartController.remove` → `CartModel.remove` |
| DELETE | `/store/cart` | `optionalStoreAuth`, `resolveCartOwner` | `cartController.clear` → `CartModel.clear` |

**`/store/orders`** — `routes/store/orders.js` (reusa `OrderController`)

**El checkout tampoco exige cuenta**, igual que el carrito: el `POST` usa `optionalStoreAuth` +
`resolveCartOwner`, y la orden que sale de un carrito de invitado queda con `userId: null` (la
columna ya lo admitía por los drafts del bot). A cambio, el invitado **debe** dar `contactName` y
`contactPhone` — sin cuenta no hay otra forma de contactarlo, así que ese requisito pisa el
`customerPhoneMode` del tenant aunque esté en `off`. El historial, en cambio, sigue siendo de la
cuenta: un invitado no tiene con qué probar que una orden es suya, y lo que ve al confirmar sale de
la respuesta del `POST`.

| Método | Ruta | Middleware | Controller → Service |
|---|---|---|---|
| POST | `/store/orders` | `optionalStoreAuth`, `resolveCartOwner`, `markStoreOrigin`, `validate(body: orderCreate)` | `OrderController.create` → `OrderModel.create` (`origin: STORE`; el 201 incluye el deep-link `wa.me` del pedido, armado con `lib/whatsapp-link.js`) |
| GET | `/store/orders` | `verifyStoreToken`, `validate(query)` | `OrderController.getAll` → `OrderModel.getAll` |
| GET | `/store/orders/:id` | `verifyStoreToken`, `validate(params)` | `OrderController.getById` → `OrderModel.getUserOrderById` |

**`/store/addresses`** — `routes/store/addresses.js` (libreta de direcciones del cliente)

Todo el router aplica `verifyStoreToken`: a diferencia del carrito, una dirección sin `User` no tiene
dueño ni forma de recuperarse. Guardar una dirección **no** la mete en la orden — el checkout copia
los campos a `Order` como snapshot.

| Método | Ruta | Middleware | Controller → Service |
|---|---|---|---|
| GET | `/store/addresses` | `verifyStoreToken` | `StoreAddressesController.getAll` → `AddressModel.getAll` |
| POST | `/store/addresses` | `validate(body: createAddress)` | `StoreAddressesController.create` → `AddressModel.create` |
| GET | `/store/addresses/:id` | `validate(params)` | `StoreAddressesController.getById` → `AddressModel.getById` |
| PATCH | `/store/addresses/:id` | `validate(params, body: updateAddress)` | `StoreAddressesController.edit` → `AddressModel.edit` (marcar default = `PATCH { isDefault: true }`, sin sub-action route) |
| DELETE | `/store/addresses/:id` | `validate(params)` | `StoreAddressesController.delete` → `AddressModel.delete` (borrado físico) |

**`/store/config`** — `routes/store/config.js`

| Método | Ruta | Middleware | Controller → Service |
|---|---|---|---|
| GET | `/store/config` | — (tenant ya resuelto por slug) | `StoreConfigController.get` → `TenantConfigModel.get` |

**`/store/mercadopago`** — `routes/store/mercadopago.js`

| Método | Ruta | Middleware | Controller → Service |
|---|---|---|---|
| POST | `/store/mercadopago/:id` | `verifyStoreToken`, `validate(params)` | `mercadopagoController.create` → `mercadopagoModel.create` |

**`/store/page`** — `routes/store/page.js`

| Método | Ruta | Middleware | Controller → Service |
|---|---|---|---|
| GET | `/store/page` | — (tenant ya resuelto por slug) | `StorePageController.get` → sirve el `publishedSpec` del `TenantPageSpec` del tenant |

**`/store/chat`** — `routes/store/chat.js`

| Método | Ruta | Middleware | Controller → Service |
|---|---|---|---|
| POST | `/store/chat/message` | `chatLimiter` (rate-limit por IP), `optionalStoreAuth` (bot anónimo; trae user si hay Bearer válido), `validate(body: chatMessageBody)` | `ChatController.sendMessage` → `services/chat/` (agente con tool-calling) |

### `/page-spec` (admin) — `routes/page-spec.js`

Todas con `verifyToken` + `requireRole(["ADMIN"])`.

| Método | Ruta | Qué hace | Controller → Service |
|---|---|---|---|
| GET | `/page-spec` | Borrador actual del tenant | `PageSpecController.getDraft` |
| PUT | `/page-spec/draft` | Guarda/actualiza el borrador (no publica), `validate(body: pageSpecDraftBody)` | `PageSpecController.saveDraft` |
| POST | `/page-spec/publish` | Promueve el borrador a publicado (acción humana) | `PageSpecController.publish` |

### `/webhooks/whatsapp` — `routes/webhooks/whatsapp.js`

Montado en `app.js` **antes** del parser JSON global (necesita el raw body para la firma). Sin
`verifyToken`: la autenticación es la firma HMAC (`X-Hub-Signature-256`, `WHATSAPP_APP_SECRET`)
más el `WHATSAPP_VERIFY_TOKEN` del handshake inicial.

| Método | Ruta | Qué hace | Controller → Service |
|---|---|---|---|
| GET | `/webhooks/whatsapp` | Handshake de verificación de la Graph API (sin body) | `WhatsappWebhookController.verify` |
| POST | `/webhooks/whatsapp` | Recepción de mensajes; valida firma sobre raw body, responde 200 antes de procesar (fire-and-forget) | `WhatsappWebhookController.receive` → `services/whatsapp/` → `services/chat/` |

### Rate limiters (`middleware/rateLimit.js`)
- `generalLimiter`: 200 req / 15 min (global; `skip` cuando **no** es producción).
- `loginLimiter`: 5 / 15 min, key por `email`, `skipSuccessfulRequests`.
- `registerLimiter`: 10 / 60 min.
- `webhookLimiter`: 30 / 60 s.
- `chatLimiter`: rate-limit por IP del chat de tienda (complementa el cost-guard por tenant en Redis, `CHAT_DAILY_LIMIT`).
- Usan store de Redis (`rate-limit-redis`) con prefijos `rl:general:`/`rl:login:`/`rl:register:`/`rl:webhook:`; si Redis no está, caen a store en memoria.

---

## 7. Capa de servicios

### Convención
- Cada feature simple es `services/<feature>.js` y exporta un objeto **`XModel`** con
  métodos `async` (p. ej. `UserModel`, `ProductModel`, `OrderModel`, `CategoryModel`,
  `CartModel`, `VariantModel`, `StatsModel`, `TenantConfigModel`, `AddressModel`, `PromoModel`,
  `mercadopagoModel`, `roleModel`).
- Features grandes son **carpetas** con `index.js` (la fachada `XModel`) y submódulos
  puros: `services/stats/`, `services/content-suggestions/`, `services/whatsapp/`,
  `services/chat/`.
- **Otra excepción a la convención `XModel`:** `services/order-state.js` es el **motor de estados de
  las órdenes** y exporta funciones, no un modelo: `ORDER_TRANSITIONS` (mapa declarativo),
  `evaluateOrder(order)` → `{ payment, blockers, canProduce, nextStatus }`, `assertTransition`,
  `assertCanProduce` y `applyAutoAdvance(tx, order)`. Todo es **puro** salvo la última, que corre
  dentro de la transacción del caller y avanza `PENDING → PROCESSING` cuando la orden queda sin
  blockers. Lo consumen `services/orders.js` (`updateOrderStatus`, `reviewOrder`, las tres
  confirmaciones de cobro) y `controllers/orders.js` (para exponer `blockers`/`canProduce`/`payment`
  al panel). Ver [[Órdenes]] §Máquina de estados.
- **Mismo patrón "modelo + módulo puro" en la caja:** `services/cash-register.js` exporta
  `CashRegisterModel` (turno, movimientos, resumen, catálogo de etiquetas) **más** la función
  `recordOrderPayments(tx, { tenantId, orderId, payments, actorId })`, que recibe el `tx` del caller y
  copia a la caja cada fila del libro de cobros que no sea `GATEWAY` — la llaman `applyPayments` y la
  liquidación de `updateOrderStatus`, los dos únicos caminos que escriben en el libro. Toda la
  aritmética del arqueo vive aparte en `services/cash-register-math.js`, **puro** (`CASH_MOVEMENT_SIGN`,
  `signedAmount`, `summarizeMovements`, `buildArqueo`), igual que `order-state.js`: se testea sin base.
  Y la planilla en `services/cash-register-export.js`, que tampoco toca la base: recibe el turno
  cargado y devuelve un buffer `.xlsx`. Ver [[Caja]].
- **Excepción a la convención `XModel`:** `services/combos.js` no exporta un modelo, sino una
  única función pura `validateComboSelection({ tx, tenantId, comboProduct, selection,
  checkStock })`, compartida por `services/cart.js` (`CartModel.addCombo`) y
  `services/orders.js` (`priceItems`, al pricear una línea `COMBO`). Agrupa la selección por
  producto+variante, valida cantidad total contra `comboMinItems/comboMaxItems` y luego la
  whitelist en dos capas: reglas **standalone** de `ComboAllowedProduct` (FK
  `comboAllowedCategoryId` null, legacy — `minQty`/`maxQty` per-producto, no suman al grupo de
  su categoría) y reglas de `ComboAllowedCategory`, donde `minQty`/`maxQty` son el **total del
  grupo** (la SUMA elegida de esa categoría) y el mínimo se exige para TODAS las reglas aunque
  la selección no traiga nada de una. Un producto sin regla standalone es permitido si es
  **miembro explícito** de una regla (fila de `ComboAllowedProduct` con la FK seteada — siempre
  permitido, suma al grupo de SU regla aunque haya cambiado de categoría después) o si su
  categoría tiene regla sin miembros explícitos (= toda la categoría). Rechaza combos anidados
  y componentes inactivos, chequea stock (`resolveProductStock`) y devuelve los `children`
  normalizados.
- Los **controllers pasan `tenantId` explícito** a cada método; los services lo usan en el
  `where` (scoping manual, §4).
- `services/productos.js` (`ProductModel`): `create`/`edit` ramifican por `Product.type`
  (PRODUCTO acepta un array `variants` opcional — puede venir vacío para alta en 2 pasos; la
  primera variante creada se marca `isDefault:true` server-side y su `sku` se autogenera vía
  `utils/sku.js generateUniqueVariantSku`, nunca lo carga el admin; rechaza `price` a nivel
  producto. COMBO exige `price` y rechaza `variants`; su whitelist canónica son las
  `comboCategoryOptions` — `[{ categoryId, minQty, maxQty, productIds }]`, donde `minQty=maxQty`
  es la cantidad exacta del grupo y `productIds` los miembros explícitos (vacío = toda la
  categoría) — de cuya suma se **derivan** `comboMinItems`/`comboMaxItems` (los del cliente se
  ignoran si vienen; solo el camino legacy de `comboOptions` sin categorías los exige
  explícitos). Valida con `ensureComboOptionsValid`/`ensureComboCategoryOptionsValid`
  (auto-referencia, combos anidados, y que cada miembro pertenezca a la categoría de su regla —
  `COMBO_MEMBER_CATEGORY_MISMATCH`)). `edit` maneja la única transición real, `PRODUCTO↔COMBO`:
  al pasar a COMBO desactiva (no borra) las variantes existentes preservando su `isDefault`
  (para poder reactivarlas si vuelve a PRODUCTO); al volver a PRODUCTO reactiva la que era
  default. Al salir de COMBO desactiva además las filas de `ComboAllowedProduct`. Si `edit`
  recibe `comboOptions`/`comboCategoryOptions`, **reemplaza esa whitelist completa** (delete +
  create transaccional; no hay merge incremental): `comboOptions` gobierna SOLO las filas
  standalone (FK null) y `comboCategoryOptions` las reglas de categoría + sus miembros (que
  caen por cascade al borrar la regla; una fila miembro reemplaza a la standalone del mismo
  producto si existía). `getComboOptions({ tenantId, id })` expone
  `comboMinItems/comboMaxItems` + `allowedProducts` (solo standalone) + `allowedCategories`
  (cada una con `memberProductIds` y `products` — sus miembros explícitos si los hay, o todos
  los productos activos de la categoría si no) con el stock resuelto vía la variante de cada
  componente (`resolveVariantForProduct`, `helpers/price.js`). Un `PRODUCTO` recién creado sin variantes todavía (alta en 2 pasos) es un
  estado transitorio válido: aparece en listados/stats pero no es agregable al carrito hasta
  tener al menos una variante (`CartModel.add` tira `VARIANT_REQUIRED`).

### Bot de WhatsApp (`services/whatsapp/`)
Canal de entrada del chatbot vía WhatsApp Business (Graph API). `index.js` expone
`WhatsappModel.processInbound`: resuelve el tenant por `phone_number_id`
(`tenant-resolver.js`, contra `TenantConfig.whatsappPhoneNumberId`), deduplica mensajes
(`dedup.js`), aplica rate-limit por remitente (`rate-limit.js`), guarda historial en Redis
(`history.js`) y delega en `ChatModel.sendMessage` (`services/chat/`) pasando
`channel: { kind: "whatsapp", waId, contactName }` — ese `channel.kind` es lo que habilita la
tool de escritura `createDraftOrder` (`CHANNEL_ORDER_TOOLS` en `lib/llm/tools/schema.js`). La
firma HMAC (`X-Hub-Signature-256`) se valida en `controllers/webhooks/whatsapp.js`
(`signature.js`); el webhook responde 200 antes de procesar (fire-and-forget) para no bloquear
la Graph API. El acceso a la Graph API en sí (`graph-api.js`) usa el token per-tenant
(`TenantConfig.whatsappAccessToken`, cifrado con `lib/crypto.js`) o cae al
`WHATSAPP_ACCESS_TOKEN` global.

### Chat de tienda / Agente LLM (`services/chat/`)
Asistente conversacional con tool-calling, montado por `/store/chat/message` y por el bot de
WhatsApp. `index.js` corre el loop agéntico (`runAgent`); `tools.js` implementa los handlers de
cada tool, incluida **`createDraftOrder`** (única tool de escritura): acepta `note` por línea
(máx 150 chars) y **rechaza explícitamente** productos `type === "COMBO"` (mensaje amigable —
el bot todavía no vende combos, ver [[Combos]] y [[WhatsApp]]). `cost-guard.js` aplica
`CHAT_DAILY_LIMIT` por tenant en Redis, **fail-closed** (a diferencia del cost-guard de
Sugerencias de contenido, que degrada abierto si Redis falla). Las specs de todas las tools
(qué tools existen, cuáles requieren usuario autenticado, cuáles solo se habilitan por canal)
viven centralizadas en `lib/llm/tools/schema.js` (`TOOL_DEFINITIONS`, `AUTHENTICATED_TOOLS`,
`CHANNEL_ORDER_TOOLS`), separado del cliente LLM one-shot de §8.

### `services/stats/`
- Fachada: **`StatsModel.getDashboard({ tenantId, days = 30, lowStockThreshold = 5 })`**
  (`services/stats.js`). Calcula período actual y previo (`addDays`/`startOfDay`).
- `queries.js → Data({ tenantId, currentStart, now, previousStart })`: 3 queries en
  paralelo (`Promise.all`) **scoped por `tenantId`**: `currentOrders` (con cadena
  `orderItems → variant → product → category/variants`), `previousOrders` (liviano) y
  `allProducts`.
- `builders.js`: `buildDailySeries`, `buildOrderStatusPanel`, `buildRevenueByCategory`,
  `buildProductRanking` (top 5, con etiquetas operativas: `best_seller`, `low_stock`,
  `out_of_stock`, `forgotten`, `no_variants`, `stable`).
- `order-helpers.js`: `isCompletedOrder`, `sumCompletedRevenue`, `sumCompletedUnits`,
  `getOrderUnits`. `utils.js`: `startOfDay`, `addDays`, `round`, `percentageChange`,
  `buildMetric` (KPI `{ current, previous, changePct }`). `constants.js`: `DAY_IN_MS`,
  `ORDER_STATUS_KEYS`.
- **Criterio:** revenue/units cuentan **solo órdenes `COMPLETED`**
  (`meta.criteria.revenueBasedOn = "COMPLETED_ORDERS"`, `rankingSize: 5`).

### `services/content-suggestions/`
Fachada `ContentSuggestionModel` (`index.js`). Firma común: `{ tenantId, ..., now = new Date() }`.

| Método | Qué hace |
|---|---|
| `getToday({ tenantId, now })` | Sugerencia **AUTO** del día. Cache Redis → busca fila `source: "AUTO"` del día → si no, `selectProduct` (Fase 1) + `generateCopy` (LLM) + persiste (`source: AUTO`). Maneja carrera `P2002` re-leyendo. **No consume cuota LLM** (ver §11). |
| `getProductAngles({ tenantId, productId, now })` | Ángulos aplicables a un producto (reusa `anglesForProduct`). |
| `generateForProduct({ tenantId, productId, angle, now })` | Copy on-demand de un (producto, ángulo). Cache → fila DB (dedupe por unique compuesto) → valida que el ángulo aplique → `consumeLlmQuota` → `generateCopy` → persiste `source: MANUAL` → cachea. 422 si el ángulo no aplica. |
| `refineProductCopy({ tenantId, productId, angle, mode, instruction, baseCopy, baseHashtags, now })` | Variación efímera de un copy ya generado. `consumeLlmQuota` + `refineCopy`. **No persiste.** |
| `getRange({ tenantId, range, now })` | Timeline de `range` días (incl. hoy); rellena días sin sugerencia con `suggestion: null`. Sin cache. |

- **Selección (Fase 1)** en `selection.js` + `angles.js`:
  - `selectProduct({ tenantId, now })`: carga datos (`loadSelectionData`: órdenes
    `COMPLETED` de la ventana, catálogo, última sugerencia), suma unidades por producto, y
    **rota los ángulos** por `ANGLE_ORDER` arrancando en el siguiente al último usado; gana
    el primer ángulo con candidato. Si ninguno → 422 `NO_SUGGESTION_CANDIDATE`.
  - `anglesForProduct({ tenantId, productId, now })`: filtra `ANGLE_ORDER` por
    `ANGLE_PREDICATES` aplicados al producto enriquecido (404 si no es del tenant).
  - Constantes: `LOW_STOCK_THRESHOLD = 5`, `NEW_ARRIVAL_DAYS = 30`, ventana de ventas
    `WINDOW_DAYS = 30`. `ANGLE_PREDICATES` y `ANGLE_SELECTORS` son la **única fuente de
    verdad** compartida entre selección diaria y tab de producto.
- `cost-guard.js`: `consumeLlmQuota` (ver §8). `queries.js`: `loadSelectionData`.

---

## 8. Cliente LLM (`lib/llm/`)

### Fachada (`lib/llm/index.js`)
```
generateCopy({ product, angle, config, refinement }) -> { copy, hashtags, model }
refineCopy({ product, angle, config, mode, instruction, baseCopy, baseHashtags }) -> { copy, hashtags, model }
```
- **Best-effort: nunca lanza** (igual que `lib/mailer`). Si el provider falla, no hay API
  key, o el JSON es inválido, devuelve un **fallback** con `model: null`:
  - En generación normal: `buildFallbackCopy` (template determinista, `fallback.js`).
  - En refinamiento: devuelve el `baseCopy`/`baseHashtags` intactos.
- `refineCopy` reusa `generateCopy` agregando un bloque `refinement`. **No persiste.**
- Provider elegido por `DEFAULTS.LLM.PROVIDER` (`LLM_PROVIDER`) vía mapa `PROVIDERS`
  (`anthropic`, `gemini`); fallback de selección = `geminiProvider`. `MAX_TOKENS = 1024`.

### Providers (fetch directo, sin SDK)
Cada provider expone un getter `model` y `generate({ system, user, maxTokens })`.

- **`providers/anthropic.js`**: `POST https://api.anthropic.com/v1/messages`, headers
  `x-api-key` + `anthropic-version: 2023-06-01`; body `{ model, max_tokens, system,
  messages:[{role:"user",content:user}] }`. Sin `temperature` ni prefills (evita 400 en
  Opus 4.x). Lee el texto de `data.content[0].text`. Lanza si falta `ANTHROPIC_API_KEY` o
  si `!res.ok`.
- **`providers/gemini.js`**: `POST .../v1beta/models/<model>:generateContent?key=<API_KEY>`;
  `system` va en `systemInstruction`, `generationConfig.responseMimeType:
  "application/json"`. Lee `data.candidates[0].content.parts[0].text`.

### Construcción del prompt (`lib/llm/prompt.js`)
- `buildPrompt({ product, angle, config, refinement }) -> { system, user }` (texto plano,
  provider-agnostic).
- `system`: rol de community manager con datos de marca de `TenantConfig` (`storeName`,
  `storeTagline`, `storeDescription`, `currency`), instrucciones de tono y formato, y exige
  **responder solo JSON** `{ copy, hashtags }` (copy ≤280 chars, 3-6 hashtags reales).
- `user`: datos del producto (`name`, `description`, `category.name`, `price`) + el
  **brief del ángulo** (`ANGLE_BRIEFS`). Para refinamiento agrega el copy previo + la
  consigna (`REFINEMENT_BRIEFS` para `shorter`/`informal`/`salesy`, o `instruction` libre
  en modo `custom`).

### Parseo (`lib/llm/parse.js`)
- `parseLlmJson(text)`: quita fences ```` ```json ````, recorta del primer `{` al último
  `}`, `JSON.parse`, valida que `copy` sea string no vacío, normaliza hashtags (fuerza `#`,
  sin espacios) y limita a **6** (`MAX_HASHTAGS`). Devuelve `null` si no se pudo (la
  fachada cae al fallback).

### System prompt y caché
- El system prompt se **reconstruye en cada llamada** (no se cachea el prompt). Lo que se
  cachea en Redis es el **resultado** (`copy`/sugerencia), ver §9.

### Cost guard / rate limit del LLM (`services/content-suggestions/cost-guard.js`)
- `consumeLlmQuota({ tenantId, now })`: `INCR` de un contador diario por tenant en Redis;
  en el primer incremento setea `EXPIRE` hasta el fin del día **UTC**. Si supera
  `DAILY_LLM_LIMIT = 15` → 429 `LLM_DAILY_LIMIT`. **Best-effort:** si Redis falla,
  *degrada abierto* (deja pasar). Solo se invoca cuando realmente se va a llamar al LLM
  (un cache/DB hit no consume cuota).

---

## 9. Redis

Cliente: `lib/redis.js` (ioredis, singleton lazy, `lazyConnect`, reconnect con backoff).
**Deshabilitado** si `CACHE_ENABLED` es `false` (`getRedis()` devuelve `null` y todo
degrada sin romper). URL desde `REDIS_URL` o `localhost:6379`.

### Usos
1. **Caché de aplicación** (`lib/cache.js`): `get`/`set`/`wrap` (JSON), `del`, `delPattern`
   (vía `scanStream`). TTL con **jitter del 10%** (`withJitter`). Helpers de namespacing:
   `tenantNs(tenantId) = "t<id>"`, `hashParams` (sha1 truncado a 12).
2. **Rate limiting** (`middleware/rateLimit.js`, `rate-limit-redis`).
3. **Cost guard del LLM** (`cost-guard.js`).

### Patrones de key y TTLs

| Uso | Patrón de key | TTL |
|---|---|---|
| Sugerencia AUTO del día | `t<tenantId>:content-suggestion:<YYYY-MM-DD>` | `SUGGESTION_TTL` = 6 h (+jitter) |
| Copy on-demand (producto+ángulo) | `t<tenantId>:content-copy:<YYYY-MM-DD>:<productId>:<angle>` | 6 h (+jitter) |
| Contador de cuota LLM | `t<tenantId>:content-llm-count:<YYYY-MM-DD>` | hasta fin de día UTC |
| Rate limit | prefijos `rl:general:` / `rl:login:` / `rl:register:` / `rl:webhook:` | ventana del limiter |

> `getRange` (timeline) **no** usa caché, para reflejar al instante cambios de status y
> regeneraciones.

---

## 10. Frontend — **NO PRESENTE**

**No existe una aplicación frontend en este repositorio.** No hay proyecto Next.js, ni
páginas/rutas, ni cliente HTTP, ni componentes UI. Por lo tanto, los puntos pedidos
(estructura de rutas/páginas Next.js, consumo de la API/cliente HTTP, convenciones de
componentes y librerías UI) son **TODO / fuera de este repo** (el frontend, si existe,
vive en otro repositorio).

Lo único relacionado es `front-md-guia/`, una carpeta de **guías de integración en
markdown** (documentación, no código), que describe cómo un frontend externo (los propios
docs asumen **Next.js**) debería consumir esta API:

| Archivo | Tema |
|---|---|
| `FRONTEND_INTEGRATION.md` | Integración general con la API |
| `FRONTEND_CONTENT_SUGGESTIONS.md` | Consumo de la feature de sugerencias |
| `FRONTEND_CONTENT_SUGGESTIONS_TIMELINE.md` | Timeline de sugerencias |
| `FRONTEND_ORDER_TRACKING.md` | Seguimiento de órdenes |
| `FRONTEND_PRICING.md` | Precios |
| `FRONTEND_PRODUCT_PRICE_REQUIRED.md` | Precio obligatorio en producto |
| `TESTING_MULTITENANT.md` | Cómo probar el comportamiento multi-tenant |

---

## 11. GAPS / INCONSISTENCIAS

- **Comentario desactualizado en `services/content-suggestions/index.js` (`getToday`).** El
  comentario dice *"El unique (tenantId, date) asegura una sola por dia"*, pero el unique
  real del schema es `@@unique([tenantId, date, productId, angle])` (4 columnas). La
  unicidad de la sugerencia AUTO del día **no** la garantiza ese constraint, sino el
  `findFirst({ where: { tenantId, date, source: "AUTO" } })`. En teoría podrían coexistir
  varias filas AUTO del mismo día con distinto producto/ángulo.
- **Sin scoping de tenant automático.** No hay extensión/middleware de Prisma que filtre por
  `tenantId`. Cada query debe agregar `tenantId` a mano → si un método lo olvida, hay
  riesgo de fuga de datos entre tenants. Es una convención, no una garantía del ORM.
- **Asimetría de autenticación admin vs store.** El admin viaja por **cookie** y
  `verifyToken` **solo lee la cookie** (no acepta `Authorization: Bearer`), mientras que la
  storefront acepta **Bearer o cookie** (`extractToken`). Existe `extractToken` en
  `middleware/auth.js` pero `verifyToken` no lo usa. Un cliente "admin" que mande Bearer no
  autenticará.
- **Credenciales de Cloudinary fuera de `config.js`.** `env.schema` exige
  `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET`, pero `DEFAULTS`
  solo expone `CLOUDINARY_FOLDER`. `lib/cloudinary.js` lee las credenciales **directo de
  `process.env`** (no pasa por `DEFAULTS`). Funciona, pero rompe la convención de "toda la
  config pasa por `config.js`".
- **Archivo duplicado de Cloudinary.** Conviven `lib/cloudinary.js` y `lib/cloudinary.ts`.
  El runtime ESM usa el `.js`; el `.ts` no se ejecuta como parte de la app.
- **`datasource db` sin `url` en el schema.** La conexión va por `@prisma/adapter-pg`
  (`lib/prisma.js`) con `DATABASE_URL`. El cliente se genera fuera de `node_modules`
  (`generated/prisma`), por lo que requiere `prisma generate` para existir.
- **Postgres no está en `docker-compose.yml`** (solo Redis). El compose no levanta toda la
  infra; la DB es externa/manual.
- **`getToday` no consume cuota de LLM.** La sugerencia AUTO del día puede invocar al LLM
  sin pasar por `consumeLlmQuota`; el cost guard (`DAILY_LLM_LIMIT = 15`) solo aplica a
  `generateForProduct` y `refineProductCopy`.
- **Ruta de prueba expuesta.** `GET /test/:id` (`routes/test.js`) es un endpoint de
  debug que solo devuelve los claims del token (protegido por `verifyToken` +
  `requireRole(["ADMIN"])`). Conviene revisar si debe existir en producción.
- **`generalLimiter` se desactiva fuera de producción** (`skip: (req) => !isProd`): en
  desarrollo/test no hay rate limit general. `loginLimiter`, `registerLimiter`,
  `chatLimiter` y `webhookLimiter` se saltean con `NODE_ENV === "test"` por el mismo
  motivo en los cuatro: el contador vive en Redis, sobrevive a la corrida, y hacía
  fallar tests que no tienen nada que ver con rate limiting.
- **Los tests comparten instancia de Redis con el server de desarrollo.** La DB sí está
  separada (`ecommerce` vs `ecommerce_test`), pero Redis es una sola: `.env.test` tiene
  que fijar `REDIS_URL=redis://127.0.0.1:6379/1` para que la suite use **otra db**. Sin
  eso, un `node app.js` levantado en paralelo se pisa con los tests en cache,
  contadores de rate limit y cost-guards. Los `.env` no se commitean, así que en una
  máquina nueva hay que acordarse.
- **`pnpm test` falla ~1 de cada 3 veces sin que falle ningún test** (flake del harness,
  no del código). El síntoma es siempre `Test Files 48 passed (49)` + `Errors 1 error` +
  **ninguna línea `FAIL`**: es `Worker exited unexpectedly`, el fork se cae al desmontar
  y los resultados de un archivo entero quedan sin reportar, con exit code no cero.
  Antes de investigar, mirar si hay líneas `FAIL`; si no las hay, volver a correr.
  Cerrar el cliente de Redis por archivo (`setupFiles` + `afterAll`) se probó y **no lo
  arregla** — y ojo: importar `lib/redis.js` en el tope de un setup file rompe los tests
  que stubbean variables de entorno, porque arrastra `config.js` y congela `DEFAULTS`
  antes de que el test pueda stubbear.
- ~~**El checkout del storefront ignora la seña del tenant.**~~ **Resuelto** (2026-07-29):
  `OrderModel.create` lee `depositEnabled`/`depositPercentage` y resuelve
  `requiresDeposit`/`depositAmount` igual que `createDraft`. Salió junto con los perfiles de flujo
  de venta, que ya obligaban a leer esa config en el mismo `select`.
- **Una devolución PARCIAL no se distingue en `PaymentStatus`.** Desde 2026-07-29 la devolución
  total sí queda en `REFUNDED` (ver `derivePaymentStatus`), pero la parcial sigue derivando del neto
  y se ve como `DEPOSIT_PAID`. El enum no tiene `PARTIALLY_REFUNDED` y no se agregó por no forzar una
  migración: el dato está en `payment.refunded`, que el panel puede mostrar. Si el negocio empieza a
  filtrar por "devueltas a medias", hay que revisarlo.
- **`TenantConfig.allowCartGuest` no tiene efecto.** El carrito de invitado
  (`middleware/guestCart.js`) no consulta el flag: emite la cookie y resuelve el `guestId` sin
  importar cómo esté configurado el tenant. O se cablea o se saca del modelo.
- **`Float` para dinero, y ahora se ve.** Todo el modelo monetario usa `Float` (`Order.total`,
  `OrderItem.price`, `depositAmount`, `OrderPayment.amount`, y desde 2026-07-29 los montos de
  [[Caja]]). El arqueo es el primer lugar donde el error de redondeo queda **frente al cliente**: una
  diferencia de $0,01 en un cierre de caja genera una llamada. Mitigado con `roundMoney` en todo
  cálculo y comparación; la mitigación real es migrar a `Decimal`, que es transversal y merece su
  propia decisión.
- **`CartItem`, `ProductVariant`, `UserAddress` y `CashRegisterSession` tienen índices únicos que no están en `prisma/schema.prisma`.**
  El caso `CartItem.variantId IS NULL` (líneas COMBO) lo cubre un índice único parcial creado a
  mano en SQL (`CartItem_cart_product_null_variant_key`, migración
  `20260708190000_product_types_add`); el caso `ProductVariant.isDefault = true` (a lo sumo una
  por producto) lo cubre otro (`ProductVariant_product_default_key`, migración
  `20260710120000_product_types_collapse_expand`); el caso `UserAddress.isDefault = true` (a lo sumo
  una dirección preseleccionada por usuario) lo cubre un tercero, en la migración
  `20260727120000_add_user_address`; y el caso `CashRegisterSession.status = 'OPEN'` (un solo turno de
  caja abierto por tenant) un cuarto, en `20260729223044_add_cash_register` — todos porque Postgres no
  colisiona `NULL` contra `NULL` en un
  `@@unique` normal / porque un índice parcial no se puede declarar en el
  DSL de Prisma. Es drift intencional (el propio schema trae comentarios pidiendo no
  "corregirlo"), pero cualquiera que lea solo el `.prisma` no lo va a ver.
- **`Product.isCombo` queda deprecado sin limpiar.** Fue reemplazado por `type = "COMBO"`, no
  se lee en ningún camino de código, pero la columna se mantiene "por si hace falta re-derivar
  `type` a mano". Candidato a limpieza futura si se confirma que no hace falta.
- ~~**El webhook de MercadoPago se come los blockers de la orden.**~~ **Resuelto** (2026-07-29):
  `getWebhook` ahora registra el cobro en el libro (`channel: GATEWAY`) y **después** intenta
  completar la orden; si hay blockers, loguea y responde 200 con el cobro ya anotado. Antes lanzaba
  `ORDER_NOT_REVIEWED` sobre una orden `STORE` sin revisar, salía como 500 y MercadoPago reintentaba
  el webhook para siempre con el cobro sin registrar.
