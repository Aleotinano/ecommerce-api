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
- **Desarrollo:** no hay subdominios en `localhost`, así que el slug se elige por **header `X-Tenant-Slug`**. Para probar varias tiendas: usá `?tenant=acme` en la URL del front y guardalo, o un selector solo-dev. Ej. de cliente:

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
| CORS admin | en **dev**: cualquier `localhost`/`127.0.0.1` (cualquier puerto). En **prod**: solo los orígenes de `ORIGINS` |
| CORS storefront | cualquier origin en dev (`storeCors`) |

> ⚠️ **Auth admin = cookie httpOnly.** Toda request al panel admin (incluido `/auth/login`) DEBE mandarse con credenciales, si no la cookie no viaja:
> - `fetch(url, { credentials: "include" })`
> - axios: `axios.create({ baseURL, withCredentials: true })`
> En producción agregá el dominio del panel admin a `ORIGINS` (separado por comas); si no, el CORS responde **500 `El origen no esta permitido`**.

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
| Token | Cookie httpOnly `access_token` (sameSite strict) | JWT en el body → mandar `Authorization: Bearer <token>` |
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
| POST/PATCH/DELETE | `/products/*` | ADMIN/STAFF | — |
| GET/POST/PATCH/DELETE | `/categories/*` | GET cookie, escritura ADMIN/STAFF | — |
| GET/POST/PATCH/DELETE | `/variants/*` | ADMIN/STAFF | — |
| GET/POST/PATCH/DELETE | `/cart/*` | cookie | — |
| POST/GET | `/orders` | cookie | — |
| GET | `/orders/all` | ADMIN/STAFF | — |
| PATCH | `/orders/:id` | ADMIN/STAFF | `{ status }` |
| GET | `/stats/dashboard` | ADMIN/STAFF | — |
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
| POST | `/store/cart/:variantId` | suma 1 |
| PATCH | `/store/cart/:variantId` | resta 1 |
| DELETE | `/store/cart` | vacía |
| POST | `/store/orders` | crea orden desde carrito |
| GET | `/store/orders` | órdenes del customer |
| GET | `/store/orders/:id` | |
| POST | `/store/mercadopago/:id` | crea preferencia → `{ init_point }` |

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
  "showOutOfStock": false, "allowCartGuest": true
}
```
> Si el tenant no tiene config → **404 `TENANT_CONFIG_NOT_FOUND`**.

`GET /store/products` → **array** de productos (sin wrapper de paginación). `GET /store/products/:id` → objeto producto. `GET /store/categories` → array.

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

# Carrito (con Bearer)
curl -X POST http://localhost:4000/store/cart/1 \
  -H "X-Tenant-Slug: acme" -H "Authorization: Bearer <token>"
```
