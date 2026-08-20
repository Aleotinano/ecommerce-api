# Frontend en localhost contra la API de producción

Cómo correr el panel y el storefront **en tu máquina** apuntando al backend que ya está
deployado en el mini PC, sin levantar nada local del lado del server.

| Dato | Valor |
|---|---|
| API | `https://micahost.tail4e0ff0.ts.net` |
| Tenant del host principal | slug `mesa-dulce` |
| Catálogo cargado | 5 categorías, 21 productos (16 sueltos + 5 combos) |
| Admin | el email con el que se creó el tenant |

> [!note] `pastaia` sigue estando
> Este deploy es multi-tenant y no tiene un tenant "por defecto" del lado del backend:
> el que se ve es el que el front nombre en `X-Tenant-Slug`. Cambiando ese header (o la
> variable `NEXT_PUBLIC_DEFAULT_TENANT`) volvés a `pastaia` —4 categorías, 15 productos,
> 111 variantes— sin tocar nada del server.

> [!important] Esto **no** es el modo dev de siempre
> El backend corre con `NODE_ENV=production`, y eso cambia tres comportamientos que en
> desarrollo no se notan. Los tres están abajo, y los tres producen errores que parecen
> bugs del front sin serlo. Leelos antes de debuggear nada.

---

## 1. Las tres diferencias con el backend local

### 1.1 El CORS ya no acepta cualquier localhost

En dev, `middleware/cors.js` acepta **cualquier** origen `localhost`/`127.0.0.1` con
cualquier puerto y cualquier subdominio. Esa rama está apagada en producción — la
condición literal es `!isProd && isLocalhostOrigin(origin)`.

Contra este server, tu origen de desarrollo pasa **sólo si está listado explícitamente**
en la variable `ORIGINS` del backend. Hoy está listado:

```
http://localhost:3000
```

Cualquier otro —otro puerto, o un subdominio como `http://mesa-dulce.localhost:3000`— se come
un **403 `CORS_ORIGIN_NOT_ALLOWED`** en el preflight. Si necesitás otro, hay que pedirlo y
agregarlo del lado del backend (ver la guía de backend).

### 1.2 La cookie del panel es `Secure; SameSite=None`

En dev es `SameSite=Strict`; en producción **tiene** que ser `None`, porque el panel y la
API viven en dominios distintos y con `Strict` el browser no la manda nunca.

Consecuencia práctica: **el origen del panel tiene que ser un contexto seguro**, o el
browser descarta una cookie `Secure`. Sirven:

- `http://localhost:<puerto>` ✅
- `http://127.0.0.1:<puerto>` ✅
- `http://cualquier-cosa.localhost:<puerto>` ✅ (Chrome trata todo `*.localhost` como confiable)
- `http://mi-panel.test:<puerto>` ❌ — no es contexto seguro, la cookie no se guarda

### 1.3 El tenant va **sólo** por header

El deploy usa Tailscale Funnel, y un nodo de Tailscale = **un solo hostname**. No hay
subdominio por tienda. La lógica de "sacar el slug del primer label del hostname" no
aplica acá: el host es el de la API y el backend lo descarta a propósito.

Toda request a `/store/*` **tiene** que mandar:

```
X-Tenant-Slug: mesa-dulce
```

Sin eso: **400 `TENANT_REQUIRED`**.

---

## 2. Configuración

### 2.1 Storefront

Corrélo en **`http://localhost:3000`**, que es el origen ya habilitado.

```ini
# .env.local del storefront
NEXT_PUBLIC_API_URL=https://micahost.tail4e0ff0.ts.net
NEXT_PUBLIC_DEFAULT_TENANT=mesa-dulce
```

El cliente HTTP manda el header en **todas** las requests, y **no** usa cookies:

```js
const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  headers: { "X-Tenant-Slug": process.env.NEXT_PUBLIC_DEFAULT_TENANT },
  // NADA de withCredentials acá: el storefront va con Bearer
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("store_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
```

> [!warning] No mezcles los clientes
> El panel usa `withCredentials`, el storefront usa `Bearer`. Un solo `axios` compartido
> para los dos es la causa número uno de bugs de auth en este proyecto. Dos instancias
> separadas, siempre.

### 2.2 Panel admin

Corrélo en un **puerto propio**, no en el 3000 del storefront. Recomendado:

```
http://panel.localhost:4310
```

Ese origen es contexto seguro (así que la cookie `Secure` funciona) y a la vez es
**dedicado**: ningún otro proyecto tuyo va a ocupar `panel.localhost:4310` por accidente,
que es justamente el riesgo de usar `localhost:3000` a secas. Hay que pedir que lo agreguen
a `ORIGINS` — ver la guía de backend, sección de seguridad, donde está explicado por qué
esto importa más para el panel que para el storefront.

```ini
# .env.local del panel
NEXT_PUBLIC_API_URL=https://micahost.tail4e0ff0.ts.net
```

```js
const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  withCredentials: true, // sin esto la cookie no viaja y todo da 401
});
// El panel NO manda X-Tenant-Slug: el tenant sale de la sesión del admin
```

Arrancalo con `next dev -p 4310` y entrá por `http://panel.localhost:4310` (no por
`localhost:4310`, porque el origen tiene que coincidir **exacto** con lo que está en
`ORIGINS`).

### 2.3 SSR — sólo si el storefront renderiza en servidor

Tres rutas las pide el servidor de Next, no el browser: `/store/config`, `/store/page` y
`/order-statuses`. Tienen un techo de rate limit más alto si se identifican como máquina.

```ini
# .env.local — SIN el prefijo NEXT_PUBLIC_
SSR_SHARED_SECRET=<el mismo valor que tiene el backend>
```

```js
// solo en el fetch server-side
headers: { "X-SSR-Key": process.env.SSR_SHARED_SECRET }
```

> [!danger] Nunca `NEXT_PUBLIC_SSR_SHARED_SECRET`
> Las variables con ese prefijo se **inlinean en el bundle del browser**: el secreto
> viajaría a cada visitante.

Si el backend no tiene la variable seteada, salteá esto: sin secreto la separación se
infiere por el header `Origin` y funciona igual mientras el front le pegue directo al
Funnel (que es el caso hoy).

---

## 3. Verificación, en orden

Hacelos en este orden: cada uno descarta una capa distinta.

**1. La API responde**

```bash
curl https://micahost.tail4e0ff0.ts.net/health
```

Esperado: `{"status":"ok"}`.

**2. El tenant resuelve**

```bash
curl -H "X-Tenant-Slug: mesa-dulce" https://micahost.tail4e0ff0.ts.net/store/config
```

Esperado: un JSON con `"storeName":"Mesa Dulce"` y `"storeMode":"SHOP"`.

**3. Tu origen está permitido** — cambiá el `Origin` por el que uses:

```bash
curl -i -X OPTIONS https://micahost.tail4e0ff0.ts.net/store/cart -H "Origin: http://localhost:3000" -H "Access-Control-Request-Method: POST"
```

Esperado: **204** y un header `access-control-allow-origin` que repita ese dominio exacto.
Si da **403**, ese origen no está en `ORIGINS`.

**4. El catálogo llega** — ojo con la paginación, el default es 10:

```bash
curl -H "X-Tenant-Slug: mesa-dulce" "https://micahost.tail4e0ff0.ts.net/store/products?limit=100"
```

Esperado: 21 productos (16 sueltos + 5 combos). Ninguno queda oculto por falta de stock:
Mesa Dulce produce por encargo y corre con `showOutOfStock: true`.

**5. Un POST real desde el browser.** Este es el que importa y ningún `curl` lo reemplaza:
agregá algo al carrito desde el storefront corriendo. Los GET pueden pasar sin header
`Origin` y dar un falso positivo; los POST siempre lo mandan.

**6. Login del panel, y la request siguiente.** El login puede devolver 200 y la request
que sigue salir 401: eso significa que la cookie no se guardó. Miralo en devtools,
Application → Cookies. Es el punto más frágil de todo este setup.

---

## 4. Errores y qué significan de verdad

| Lo que ves | Causa real |
|---|---|
| `403 CORS_ORIGIN_NOT_ALLOWED` | Tu origen no está en `ORIGINS`. El puerto y el esquema cuentan: `http://localhost:3000` ≠ `http://localhost:3001` |
| `400 TENANT_REQUIRED` | Falta el header `X-Tenant-Slug` en una ruta `/store/*` |
| `404 TENANT_NOT_FOUND` | El slug no existe. Con este deploy también puede ser que `BASE_URL` esté mal en el backend |
| Login 200 y después 401 | Falta `withCredentials` / `credentials: "include"`, o la cookie no se guardó por contexto no seguro |
| El catálogo carga y el carrito tira 403 | Clásico: el GET pasó sin `Origin` y el POST no. Tu origen falta en `ORIGINS` |
| `429 RATE_LIMIT_EXCEEDED` | 200 req / 15 min por IP. Un hot-reload agresivo lo puede tocar |
| Solo llegan 10 productos | No es un bug: `limit` tiene default 10, máximo 100 |

---

## 5. Lo que no va a andar, y está bien

Tres módulos están **apagados a propósito** en este deploy. No son bugs:

| Módulo | Qué pasa |
|---|---|
| MercadoPago | `503 MERCADOPAGO_NOT_CONFIGURED` al crear una preferencia. El cobro es efectivo/transferencia, flujo manual |
| WhatsApp | El webhook responde inactivo |
| Emails | SMTP apagado: no salen mails de verificación ni de nada |
| Registro de admin por HTTP | `POST /auth/register` está deshabilitado; las altas son por consola en el server |

Y dos datos del tenant `mesa-dulce` todavía sin cargar: `contactPhone` y `contactAddress`
(a `pastaia` le faltan los mismos). Si el front los pinta, va a mostrar vacío hasta que se
carguen desde el panel.
