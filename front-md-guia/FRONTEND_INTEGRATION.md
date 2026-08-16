---
lado: contrato
---

# Guía de integración Frontend ↔ API

Referencia para conectar el frontend al backend multi-tenant. Hay **dos apps cliente** distintas que pegan al mismo backend:

1. **Panel Admin** (dueños/empleados) → rutas SIN prefijo, auth por **cookie**
2. **Storefront** (compradores, frontend en el dominio del tenant) → rutas `/store/*`, auth por **Bearer token**

---

## 0. Arquitectura de dominios y ruteo (leer primero)

Son **dos frontends separados**, NO un solo sitio con un menú. Cada uno vive en su propio dominio y nunca comparten login. La raíz es de admins; los clientes entran directo a la tienda del tenant.

```
                         ┌─────────────────────────────────────────────┐
  midominio.com   ──────▶│  APP ADMIN  (raíz, sin subdominio)           │
  app.midominio.com      │  Dueños/empleados + "Crear tu tienda"        │
                         │  Auth: cookie · Rutas: /auth/* , /products…  │
                         └─────────────────────────────────────────────┘

  acme.midominio.com ───▶┌─────────────────────────────────────────────┐
  shopco.midominio.com   │  STOREFRONT  (subdominio = tenant)           │
                         │  Clientes de ESA tienda                      │
                         │  Auth: Bearer · Rutas: /store/*              │
                         └─────────────────────────────────────────────┘
```

### Quién entra por dónde

| Persona | Entra por | Login | App |
|---------|-----------|-------|-----|
| Quiere **crear una tienda** | raíz (`midominio.com`) | `POST /auth/register` (crea tenant + ADMIN) | Admin |
| **Dueño/empleado** de una tienda | raíz (`midominio.com`) | `POST /auth/login` | Admin |
| **Cliente/comprador** | el subdominio de la tienda (`acme.midominio.com`) | `POST /store/auth/login` | Storefront |

> Regla mental: **la raíz nunca muestra productos de un tenant**. La raíz es marketing + login/registro de dueños. Si alguien llega a `acme.midominio.com` ya está "dentro" de la tienda acme y no necesita pasar por la raíz.

### Cómo el cliente llega directo a su tienda (sin pasar por la raíz)

El tenant se identifica por **subdominio** (lo resuelve el backend, ver §3). El frontend storefront no tiene que elegir tenant en una pantalla: el host ya lo dice.

- **Producción:** cada tienda se sirve en su subdominio. `acme.midominio.com` → el front lee `window.location.hostname`, saca el primer label (`acme`) y lo manda como `X-Tenant-Slug` en cada request a `/store/*`. (El backend igual lo deduce solo del subdominio, pero mandar el header lo hace robusto detrás de proxies.)
- **Desarrollo:** los browsers resuelven cualquier `*.localhost` a loopback, así que `http://acme.localhost:3000` funciona igual que en producción y el CORS del backend lo acepta. El backend **no** saca el slug de ese host (`acme.localhost` tiene 2 labels y `extractSlugFromHost` pide 3), así que el front igual manda el **header `X-Tenant-Slug`** — que es el mecanismo real en dev. Alternativa sin subdominio: `?tenant=acme` en la URL del front y guardalo, o un selector solo-dev. Ej. de cliente:

```js
// storefront/src/api.js
const slug =
  // prod: acme.midominio.com -> "acme"
  (location.hostname.split(".").length >= 3 &&
    !["www", "api", "app"].includes(location.hostname.split(".")[0])
    ? location.hostname.split(".")[0]
    : null) ||
  // dev: ?tenant=acme  (persistido en localStorage)
  new URLSearchParams(location.search).get("tenant") ||
  localStorage.getItem("tenant");

export const storeApi = axios.create({
  baseURL: "http://localhost:4000",
  headers: { "X-Tenant-Slug": slug },
  // storefront NO usa cookies → no withCredentials
});
storeApi.interceptors.request.use((cfg) => {
  const t = localStorage.getItem("store_token");
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});
```

```js
// admin/src/api.js  (app de la raíz, auth por cookie)
export const adminApi = axios.create({
  baseURL: "http://localhost:4000",
  withCredentials: true, // imprescindible: la cookie httpOnly viaja sola
  // NO se manda X-Tenant-Slug: el tenant del admin sale de su sesión
});
```

### Ruteo interno de cada front (ejemplo React Router)

```
APP ADMIN (raíz)                  STOREFRONT (subdominio del tenant)
  /                  landing        /                  home de la tienda
  /crear-tienda      register       /productos         catálogo
  /login             login          /productos/:id     detalle
  /dashboard         (cookie)       /carrito           (Bearer)
  /dashboard/productos              /cuenta/login      store login
  /dashboard/ordenes                /cuenta/registro   store register
  /dashboard/config  (solo ADMIN)   /cuenta/verify-email?token=...
```

> Dos apps = dos builds/deploys separados. No mezclar los `axios`: el admin usa `withCredentials`, el storefront usa `Bearer`. Mezclarlos es la causa #1 de bugs de auth.

---

## 1. Config / acceso

| Dato | Valor |
|------|-------|
| API URL | `http://localhost:4000` (`.env` → `PORT=4000`) |
| CORS admin | en **dev**: cualquier `localhost`/`127.0.0.1`, con o sin subdominio de un nivel (`mesa-dulce.localhost:3000`), cualquier puerto. En **prod**: solo los orígenes de `ORIGINS` |
| CORS storefront | en **dev**: cualquier origin. En **prod**: igual que el panel — el dominio de la tienda tiene que estar en `ORIGINS`. `storeCors` no lo exime: el CORS global decide antes |

> ⚠️ **Auth admin = cookie httpOnly.** Toda request al panel admin (incluido `/auth/login`) DEBE mandarse con credenciales, si no la cookie no viaja:
> - `fetch(url, { credentials: "include" })`
> - axios: `axios.create({ baseURL, withCredentials: true })`
> En producción agregá a `ORIGINS` (CSV) el dominio del panel admin **y el de cada storefront**; si no, el CORS responde **403 `CORS_ORIGIN_NOT_ALLOWED`**.

**Usuarios de prueba** (password de todos: `password123`):

| Tenant slug | ADMIN | STAFF | CUSTOMER |
|-------------|-------|-------|----------|
| `acme` | admin@acme.com | staff@acme.com | customer@acme.com |
| `shopco` | admin@shopco.com | staff@shopco.com | customer@shopco.com |

> Levantar el backend con `pnpm dev` antes de probar.

---

## 2. Roles

`ADMIN`, `STAFF`, `CUSTOMER` (el rol `USER` fue eliminado — no debe quedar hardcodeado en el front).

- **ADMIN**: acceso total
- **STAFF**: gestiona productos, categorías, variantes, órdenes y stats. **NO** puede cambiar roles ni la config del tenant → ocultar "Roles/Usuarios" y "Configuración de tienda" en el dashboard
- **CUSTOMER**: comprador del storefront

---

## 3. Detección de tenant (solo `/store/*`)

Toda request a `/store/*` debe identificar el tenant por:

- **Producción**: subdominio → primer label del hostname si hay 3+ partes, ignorando `www`/`api`/`app`. Ej: `acme.midominio.com` → slug `acme`.
- **Dev/local**: header `X-Tenant-Slug: acme` (obligatorio en TODAS las requests `/store/*`).

---

## 4. Sesión / Auth

| | Panel Admin | Storefront |
|--|-------------|------------|
| Login | `POST /auth/login` | `POST /store/auth/login` |
| Token | Cookie httpOnly `access_token` (en **prod** `SameSite=None; Secure`, porque el panel y la API viven en dominios distintos; `Strict` en dev) | JWT en el body → mandar `Authorization: Bearer <token>` |
| Almacenamiento | el browser maneja la cookie | el front guarda el token (localStorage/memoria) |

El storefront NO usa cookies. Cada request protegida necesita `Authorization: Bearer <token>` + `X-Tenant-Slug`.

---

## 5. Endpoints — Panel Admin (cookie auth)

| Método | Ruta | Auth | Body |
|--------|------|------|------|
| POST | `/auth/register` | — | `{ username, password, email, tenantName }` (crea tenant + ADMIN) |
| POST | `/auth/login` | — | `{ email, password }` (ADMIN/STAFF) |
| GET | `/auth/me` | cookie | — |
| POST | `/auth/logout` | — | — |
| GET | `/products` | cookie | query: name, categoryId, variantColor, variantSize, minPrice, maxPrice, limit, offset |
| POST/PATCH/DELETE | `/products/*` | ADMIN/STAFF | `type` requerido en alta (`UNIDAD`/`VARIANTE`/`COMBO`) — ver [FRONTEND_PRODUCT_TYPES.md](FRONTEND_PRODUCT_TYPES.md) |
| GET/POST/PATCH/DELETE | `/categories/*` | GET cookie, escritura ADMIN/STAFF | — |
| GET/POST/PATCH/DELETE | `/variants/*` | ADMIN/STAFF | solo productos `VARIANTE` |
| GET/POST/PATCH/DELETE | `/cart/*` | cookie | rutas por `:productId`, no `:variantId` — ver [FRONTEND_PRODUCT_TYPES.md](FRONTEND_PRODUCT_TYPES.md) |
| POST/GET | `/orders` | cookie | GET query: `status, limit, offset` |
| GET | `/orders/all` | ADMIN/STAFF | query: `status, search, limit, offset` |
| GET | `/orders/:id` | cookie | incluye `timeline` |
| PATCH | `/orders/:id` | ADMIN/STAFF | `{ status, note? }` — `NEW`/`PROCESSING`/`READY`/`COMPLETED`/`CANCELLED`, solo hacia adelante |
| GET/POST | `/orders/:id/payments` | ADMIN/STAFF | libro de cobros — ver [FRONTEND_ORDER_TRACKING.md](FRONTEND_ORDER_TRACKING.md) §1.3 |
| GET/POST | `/orders/:id/receipts` | ADMIN/STAFF | comprobantes de transferencia (imagen o PDF). **Subir no confirma**, y la URL del archivo **vence a los 10 min** — ver [FRONTEND_TRANSFER_RECEIPTS.md](FRONTEND_TRANSFER_RECEIPTS.md) |
| DELETE | `/orders/:id/receipts/:receiptId` | **ADMIN** | borra el archivo de verdad + soft-delete de la fila |
| GET | `/stats/dashboard` | ADMIN/STAFF | desde 2026-07-30 suma `cobranzas` (facturado vs cobrado + vía) y `caja` (`null` si no está habilitada) — ver [FRONTEND_CASH_REGISTER.md](FRONTEND_CASH_REGISTER.md) §9 |
| GET/POST | `/cash-register/*` | ADMIN/STAFF | turno de caja, movimientos y arqueo. **404 `CASH_REGISTER_DISABLED`** si el tenant no lo tiene habilitado — ver [FRONTEND_CASH_REGISTER.md](FRONTEND_CASH_REGISTER.md) |
| POST/PATCH/DELETE | `/cash-register/categories*` | **ADMIN** | catálogo de etiquetas de movimiento (sueldos, insumos…) |
| PATCH | `/users/:id` | **ADMIN** | `{ role }` |
| GET | `/tenant-config/:tenantId` | opcional | — |
| PATCH/DELETE | `/tenant-config/:tenantId*` | **ADMIN** | — |

---

## 6. Endpoints — Storefront (`X-Tenant-Slug` obligatorio)

### Públicas (sin login)
| Método | Ruta | Notas |
|--------|------|-------|
| GET | `/store/products` | query: name, categoryId, variantColor, variantSize, minPrice, maxPrice, limit, offset |
| GET | `/store/products/options` | colores y tallas disponibles |
| GET | `/store/products/:id` | |
| GET | `/store/categories` | query opcional `includeChildren=true` |
| GET | `/store/categories/tree` | |
| GET | `/store/categories/:id` | |
| GET | `/store/config` | branding/social/políticas del tenant |

### Auth customer
| Método | Ruta | Body |
|--------|------|------|
| POST | `/store/auth/register` | `{ username, email, password }` (crea CUSTOMER, manda email de verificación) |
| POST | `/store/auth/login` | `{ email, password }` (devuelve `token`) |
| GET | `/store/auth/me` | Bearer |
| POST | `/store/auth/logout` | — |
| GET | `/store/auth/verify-email?token=...` | el link del email apunta a `STORE_APP_URL/cuenta/verify-email?token=...` |
| POST | `/store/auth/resend-verification` | `{ email }` |

### Autenticadas (Bearer + X-Tenant-Slug)
| Método | Ruta | Notas |
|--------|------|-------|
| GET | `/store/cart` | |
| POST | `/store/cart/:productId` | suma 1; body `{ variantId? }` (solo si el producto es VARIANTE) |
| POST | `/store/cart/combo/:productId` | arma y agrega un combo; body `{ selection: [...] }` |
| PATCH | `/store/cart/:productId` | resta 1; body `{ variantId? }` |
| DELETE | `/store/cart` | vacía |
| POST | `/store/orders` | crea orden desde carrito · body **obligatorio** (entrega + pago) y respuesta con deep-link de WhatsApp → [FRONTEND_CHECKOUT.md](FRONTEND_CHECKOUT.md) |
| GET | `/store/orders` | órdenes del customer · query: `status, limit, offset` |
| GET | `/store/orders/:id` | incluye `timeline` (seguimiento del pedido) |
| POST | `/store/mercadopago/:id` | crea preferencia → `{ init_point }` |

> **Productos y carrito por tipo (UNIDAD/VARIANTE/COMBO):** desde 2026-07-08 las rutas de carrito son
> por `:productId` (antes `:variantId`) y todo alta/edición de producto exige `type`. Contrato completo,
> breaking changes y ejemplos en [FRONTEND_PRODUCT_TYPES.md](FRONTEND_PRODUCT_TYPES.md); armado de
> combos en [FRONTEND_COMBOS.md](FRONTEND_COMBOS.md).

> **Checkout (breaking, 2026-07-23 / 2026-07-26):** `POST /store/orders` y `POST /orders` exigen
> `fulfillmentMethod` + `paymentMethod` en el body; si el pago es mixto van también los montos, y si
> es envío va la ubicación (dirección y/o link de Google Maps). La respuesta trae un deep-link `wa.me`
> con el pedido redactado, y las órdenes del storefront requieren revisión de un admin antes de pasar
> a producción. Contrato completo en [FRONTEND_CHECKOUT.md](FRONTEND_CHECKOUT.md).

---

## 7. Shapes de respuesta

`POST /store/auth/login`:
```json
{
  "message": "Bienvenido customer_acme",
  "token": "<jwt>",
  "usuario": { "id": 1, "username": "customer_acme", "role": "CUSTOMER" },
  "tenant": { "slug": "acme" }
}
```
> El usuario está en `usuario` (no `user`) y **no** trae email en el login. El `token` va al nivel raíz.

`GET /store/auth/me`:
```json
{
  "usuario": { "id": 1, "username": "customer_acme", "email": "customer@acme.com", "role": "CUSTOMER", "tenantId": 1 },
  "tenant": { "slug": "acme" }
}
```

`GET /store/config` → objeto plano (sin wrapper):
```json
{
  "id": 1,
  "storeName": "Acme Store",
  "storeDescription": "...",
  "storeTagline": "...",
  "logoUrl": "https://...",
  "contactEmail": "...", "contactPhone": "...", "contactAddress": "...",
  "socialInstagram": null, "socialTiktok": null, "socialFacebook": null,
  "socialTwitter": null, "socialYoutube": null, "socialPinterest": null, "socialWhatsapp": null,
  "seoTitle": null, "seoDescription": null, "seoKeywords": null,
  "shippingPolicy": null, "returnsPolicy": null, "privacyPolicy": null,
  "currency": "ARS", "locale": "es-AR",
  "showOutOfStock": false, "allowCartGuest": true,

  "paymentMethodsEnabled": ["CASH", "TRANSFER", "MIXED"],
  "fulfillmentMethodsEnabled": ["DELIVERY", "PICKUP"],
  "depositEnabled": false, "depositPercentage": 50,
  "cashRegisterEnabled": false
}
```
> Si el tenant no tiene config → **404 `TENANT_CONFIG_NOT_FOUND`**.

### ⚠️ Cambio de contrato (2026-07-29): flujo de venta

Los **cinco** campos nuevos del final son **solo lectura**: se leen por `GET` pero un `PATCH
/tenant-config/:tenantId` que los incluya devuelve **400**, incluso mezclados con campos válidos
(o sea: no se guarda nada, tampoco el resto del body). Deciden cuándo una orden puede producirse y
cuánta plata se exige antes, y los configuramos nosotros por tenant — si el dueño de la tienda los
cambiara, podría trabar pedidos que ya están en curso.

**Qué hacer en el panel:** si hubiera controles para `depositEnabled`/`depositPercentage`, sacarlos
(antes eran editables). Mostrarlos como informativos está bien.

**Qué hacer en el checkout:** pintar únicamente los métodos que vengan en `paymentMethodsEnabled` y
`fulfillmentMethodsEnabled`, en vez de hardcodear los tres pagos y las dos entregas. Si se manda uno
no habilitado, el `POST /store/orders` responde 400 con
`code: "PAYMENT_METHOD_NOT_ENABLED"` o `"FULFILLMENT_METHOD_NOT_ENABLED"` y
`details: { pedido, habilitados }` — ese `habilitados` sirve para el mensaje de error.

Una lista vacía significa **todo habilitado**, no "ninguno".

**`cashRegisterEnabled` (2026-07-29)** se suma a esa lista de solo-lectura y es la llave del módulo de
caja: con `false` toda la sección `/cash-register` responde 404 y no hay que mostrarla. Prendido,
además, **cobrar sin turno abierto falla** (`409 CASH_SESSION_NOT_OPEN`) — impacta las pantallas de
órdenes, ver [FRONTEND_CASH_REGISTER.md](FRONTEND_CASH_REGISTER.md) §6.

`GET /store/products` → **array** de productos (sin wrapper de paginación). `GET /store/products/:id` → objeto producto. `GET /store/categories` → array.

> **Órdenes — seguimiento y monitoreo:** shapes del `timeline`, filtros (`status`/`search`), paginación y `PATCH /orders/:id` con `note` están en [FRONTEND_ORDER_TRACKING.md](FRONTEND_ORDER_TRACKING.md).

> **Comprobantes de transferencia (2026-07-30):** adjuntar la captura o el PDF del banco a una orden,
> el estado intermedio "hay comprobante, falta confirmar" (`receiptsCount` en el listado,
> `blockers[].details.comprobantes` en el detalle) y las URLs firmadas que **vencen**, en
> [FRONTEND_TRANSFER_RECEIPTS.md](FRONTEND_TRANSFER_RECEIPTS.md).

---

## 8. Códigos de error a manejar

| Código | Cuándo |
|--------|--------|
| 400 `TENANT_REQUIRED` | falta `X-Tenant-Slug` |
| 404 `TENANT_NOT_FOUND` | slug inexistente |
| 403 `TENANT_INACTIVE` | tienda deshabilitada |
| 404 `TENANT_CONFIG_NOT_FOUND` | tenant sin config |
| 401 | Bearer ausente/inválido en rutas protegidas |
| 403 | token de otro tenant (customer de "acme" usando su token en "shopco") |
| 403 `EMAIL_NOT_VERIFIED` | login antes de verificar email → mostrar pantalla de verificación |
| 409 `EMAIL_EXISTS` / `USERNAME_EXISTS` | en registro |

---

## 9. Ejemplos curl

```bash
# Productos públicos del tenant acme
curl -H "X-Tenant-Slug: acme" http://localhost:4000/store/products

# Registro customer
curl -X POST http://localhost:4000/store/auth/register \
  -H "X-Tenant-Slug: acme" -H "Content-Type: application/json" \
  -d '{"username":"juan","email":"juan@test.com","password":"secret123"}'

# Login customer (devuelve token)
curl -X POST http://localhost:4000/store/auth/login \
  -H "X-Tenant-Slug: acme" -H "Content-Type: application/json" \
  -d '{"email":"customer@acme.com","password":"password123"}'

# Carrito (con Bearer) — :1 es el productId, no una variante
curl -X POST http://localhost:4000/store/cart/1 \
  -H "X-Tenant-Slug: acme" -H "Authorization: Bearer <token>"
```
