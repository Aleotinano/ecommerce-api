---
lado: contrato
---

# Guía de testing multi-tenant

## 1. Setup

```bash
# instalá las nuevas dependencias (nodemailer, pino, pino-http, pino-pretty)
pnpm install

# aplicá la migración
pnpm exec prisma migrate dev

# regenerá el client
pnpm exec prisma generate

# corre el seed (resetea data y crea 2 tenants; admins ya quedan emailVerified=true)
pnpm exec prisma db seed

# levanta el server
pnpm dev
```

### Variables de entorno relevantes

```env
APP_URL=http://localhost:3001          # se usa para construir el link de verificación
MAIL_FROM="No Reply <no-reply@localhost>"
# SMTP (opcionales — si faltan, el email se loguea por consola en vez de enviarse)
# SMTP_HOST=smtp.tu-proveedor.com
# SMTP_PORT=587
# SMTP_SECURE=false
# SMTP_USER=...
# SMTP_PASS=...
LOG_LEVEL=debug                        # opcional; default: debug en dev, info en prod
```

> En dev, si no configurás SMTP, el mail no se manda: el link de verificación se
> imprime en los logs con `[DEV] Email no enviado…`. Copialo del log para
> verificar manualmente.

Datos creados:

| Tenant slug | Admin email        | Admin username | Password      |
| ----------- | ------------------ | -------------- | ------------- |
| `acme`      | `admin@acme.com`   | `admin_acme`   | `password123` |
| `shopco`    | `admin@shopco.com` | `admin_shopco` | `password123` |

Cada tenant tiene su propio catálogo (categorías + productos + variantes).

## 1.5 Suite automatizada (Vitest)

El repo trae una suite de tests de integración corriendo contra una DB Postgres
de test (variable `DATABASE_URL` con `_test` en el nombre, definida en `.env.test`).

```bash
pnpm exec vitest run            # corre toda la suite
pnpm exec vitest run tests/tenant-config.test.js   # un archivo en particular
pnpm exec vitest                # modo watch
```

Archivos cubiertos:

| Archivo                       | Qué prueba                                                      |
| ----------------------------- | --------------------------------------------------------------- |
| `tests/auth.test.js`          | Login por email, /me, slug del tenant en la respuesta           |
| `tests/isolation.test.js`     | Aislamiento cross-tenant (categorías/productos/cart) + register |
| `tests/products.test.js`      | Resolución de precios (variante vs producto) y BD               |
| `tests/tenant-config.test.js` | GET/PATCH /tenant-config y DELETE /tenant-config/:id/logo       |

Helpers compartidos en `tests/helpers.js`:

- `seedTenants()` — limpia la DB y crea 2 tenants (`acme`, `shopco`) con admins
  `admin@acme.com` / `admin@shopco.com` (password `password123`, `emailVerified=true`).
- `seedTenantConfig(tenantId, overrides?)` — upsertea una `TenantConfig` demo.
- `loginAs(app, { email, password? })` — hace login HTTP y devuelve `{ res, cookie }`.
- `cookieFor(user)` — firma un JWT con el secreto del proyecto y devuelve la cookie
  `access_token=...` sin tocar el endpoint de login (útil para bypassear el
  `loginLimiter` cuando un test necesita varias sesiones).

## 2. Tests críticos a correr (manual con curl)

> Asumo `BASE_URL=http://localhost:3001`. Ajustá si usás otro puerto.
> Los ejemplos usan `curl` con cookie jar para mantener sesión.

### 2.1 Login resuelve el tenant a partir del email

El login pide **email + password**. El backend localiza al usuario por email
(globalmente único), deriva el `tenantId` y devuelve el `tenant.slug` en la
respuesta. El frontend debe persistir ese slug (localStorage) y mandarlo en
el header `X-Tenant-Slug` en peticiones posteriores (o usar subdominio en
producción).

```bash
# OK (login por email, sin header)
curl -c acme.cookies -X POST $BASE_URL/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@acme.com","password":"password123"}'

# La respuesta incluye:
#   "tenant": { "slug": "acme" }
# Guardalo en el cliente para usarlo después como X-Tenant-Slug.

# FALLA esperada: email/password inválidos → 401 INVALID_CREDENTIALS
curl -X POST $BASE_URL/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@acme.com","password":"wrong"}'
```

### 2.2 /me devuelve tenantId y tenant.slug

```bash
curl -b acme.cookies $BASE_URL/auth/me
# debe incluir "tenantId" y "tenant.slug" en la respuesta
```

### 2.3 Aislamiento de catálogo (clave)

Loguea ambos admins en cookies separadas:

```bash
curl -c shopco.cookies -X POST $BASE_URL/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@shopco.com","password":"password123"}'
```

```bash
# acme sólo ve sus propias categorías ("Remeras", "Pantalones")
curl -b acme.cookies $BASE_URL/categories

# shopco sólo ve las suyas ("Electrónica")
curl -b shopco.cookies $BASE_URL/categories
```

Mismo test con productos:

```bash
curl -b acme.cookies   $BASE_URL/products
curl -b shopco.cookies $BASE_URL/products
```

**Validación:** ningún tenant debe ver datos del otro.

### 2.4 Cross-tenant attack — debe fallar con 404

Anotá un ID de categoría/producto de `shopco` (lo ves en `GET /categories` con su cookie).
Después, con la cookie de `acme`, intentá leer/editar ese ID:

```bash
# acme intenta leer categoría de shopco → 404 CATEGORY_NOT_FOUND
curl -b acme.cookies $BASE_URL/categories/<id-de-shopco>

# acme intenta editar producto de shopco → 404 PRODUCT_NOT_FOUND
curl -b acme.cookies -X PATCH $BASE_URL/products/<id-de-shopco> \
  -H "Content-Type: application/json" \
  -d '{"name":"hackeado"}'

# acme intenta borrar variante de shopco → 404 VARIANT_NOT_FOUND
curl -b acme.cookies -X DELETE $BASE_URL/variants/<productId-shopco>/<variantId-shopco>
```

### 2.5 Username puede repetirse entre tenants; email NO

```bash
# registro en tenant A (slug se autogenera de tenantName)
curl -X POST $BASE_URL/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"cliente1","password":"secret123","email":"c1@x.com",
       "tenantName":"Tenant A"}'
# → 201 con tenant.slug === "tenant-a"

# mismo username pero distinto email y tenant → OK (username único POR tenant)
curl -X POST $BASE_URL/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"cliente1","password":"secret123","email":"c2@x.com",
       "tenantName":"Tenant B"}'
# → 201 con tenant.slug === "tenant-b"

# email repetido → 409 EMAIL_EXISTS
curl -X POST $BASE_URL/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"otro","password":"secret123","email":"c1@x.com",
       "tenantName":"Tenant C"}'
```

### 2.6 SKU duplicado entre tenants — OK; dentro del mismo tenant — falla

```bash
# crear variante con SKU "ACM-REM-NM" en shopco → debe permitirse
# crear variante con SKU "ACM-REM-NM" en acme (ya existe) → 500/unique error
```

### 2.7 Carrito y órdenes scope por tenant

```bash
# acme agrega una variante propia al carrito
curl -b acme.cookies -X POST $BASE_URL/cart/<variantId-acme>

# acme intenta agregar una variante de shopco → 404 VARIANT_NOT_FOUND
curl -b acme.cookies -X POST $BASE_URL/cart/<variantId-shopco>

# acme crea orden
curl -b acme.cookies -X POST $BASE_URL/orders

# acme lista sus órdenes → solo las propias
curl -b acme.cookies $BASE_URL/orders

# shopco lista → no ve órdenes de acme
curl -b shopco.cookies $BASE_URL/orders
```

### 2.8 Stats aislados por tenant

```bash
curl -b acme.cookies   "$BASE_URL/stats/dashboard?days=30"
curl -b shopco.cookies "$BASE_URL/stats/dashboard?days=30"
```

Los KPIs deben reflejar solo la data del tenant logueado.

### 2.9 Signup self-service crea Tenant + ADMIN (slug autogenerado, email sin verificar)

```bash
curl -X POST $BASE_URL/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"founder","password":"secret123","email":"f@new.com",
       "tenantName":"Mi tienda nueva"}'

# → 201:
#   {
#     "message": "Tenant y usuario registrados. Revisá tu email para verificar la cuenta.",
#     "usuario": { ..., "emailVerified": false },
#     "tenant": { "slug": "mi-tienda-nueva", ... }
#   }
```

En los logs del server vas a ver algo así (cuando no hay SMTP configurado):

```
[DEV] Email no enviado (SMTP no configurado) — log local
  to: "f@new.com"
  subject: "Verificá tu email para Mi tienda nueva"
  preview: "Para activar tu cuenta hacé clic en el siguiente link:\nhttp://localhost:3001/auth/verify-email?token=..."
```

Repetir el mismo `tenantName` debe dar 409 `TENANT_EXISTS` con sugerencias:

```json
{
  "error": {
    "code": "TENANT_EXISTS",
    "message": "El tenant ya existe",
    "details": {
      "slug": "mi-tienda-nueva",
      "suggestions": [
        "mi-tienda-nueva-2",
        "mi-tienda-nueva-3",
        "mi-tienda-nueva-4"
      ]
    }
  }
}
```

Si `tenantName` slugifica a algo inválido (ej. `"!!!"`) → 400 `INVALID_TENANT_NAME`.

### 2.10 Verificación de email

El usuario recién registrado **no puede loguear** hasta verificar.

```bash
# Login con email no verificado → 403 EMAIL_NOT_VERIFIED
curl -X POST $BASE_URL/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"f@new.com","password":"secret123"}'
# →
# {
#   "error": {
#     "code": "EMAIL_NOT_VERIFIED",
#     "message": "Debes verificar tu email antes de iniciar sesión",
#     "details": { "email": "f@new.com" }
#   }
# }
```

Verificar (copiá el link de los logs o del email real):

```bash
curl "$BASE_URL/auth/verify-email?token=<TOKEN>"
# → { "message": "Email verificado correctamente", "alreadyVerified": false }

# Si lo abrís de vuelta:
# → { "message": "El email ya estaba verificado", "alreadyVerified": true }
```

Reenviar el link de verificación:

```bash
curl -X POST $BASE_URL/auth/resend-verification \
  -H "Content-Type: application/json" \
  -d '{"email":"f@new.com"}'
# → 200 con mensaje genérico (no revela si el email existe o no, por seguridad)
```

Casos de error:

```bash
# Token inválido o ya consumido
curl "$BASE_URL/auth/verify-email?token=basura"
# → 400 INVALID_VERIFICATION_TOKEN

# Token expirado (>24h)
# → 400 VERIFICATION_TOKEN_EXPIRED
```

Después de verificar, el login funciona normalmente:

```bash
curl -c f.cookies -X POST $BASE_URL/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"f@new.com","password":"secret123"}'
# → 200 con tenant.slug y cookie access_token
```

### 2.11 Logs estructurados (Pino)

Cada request loguea en JSON (prod) o pretty-print (dev) con `tenantId`, `userId`,
`method`, `url`, `statusCode`, `responseTime`. Ejemplo en dev:

```
14:23:45.123 INFO  request completed
  req: { method: "GET", url: "/categories" }
  res: { statusCode: 200 }
  responseTime: 12
  tenantId: 1
  userId: 3
```

Errores 5xx se loguean en nivel `error` con stack trace; 4xx en `warn`.
Headers sensibles (`cookie`, `authorization`, `x-tenant-slug`) están redactados.

## 3. Checklist rápido (manual)

- [ ] Register crea tenant + admin (rol ADMIN), slug autogenerado del tenantName
- [ ] Register con tenantName que colisiona → 409 con `details.suggestions`
- [ ] Register con email ya usado → 409 `EMAIL_EXISTS`
- [ ] Login con email+password inválidos → 401 `INVALID_CREDENTIALS`
- [ ] Login OK → respuesta incluye `tenant.slug` y cookie con JWT
- [ ] JWT incluye tenantId (decodificá el token en jwt.io)
- [ ] /me devuelve tenantId y `tenant.slug`
- [ ] GET /categories sin login → 401
- [ ] GET /categories con cookie de tenant A → solo categorías de A
- [ ] Cross-tenant GET/PATCH/DELETE por id → 404
- [ ] Cart no permite variantes de otro tenant
- [ ] Orders se listan scope por tenant
- [ ] Stats scope por tenant
- [ ] SKU global ya no es único; sí lo es por tenant
- [ ] Username puede repetirse entre tenants; email NO (es único global)
- [ ] Register dispara email de verificación (link en logs o mailbox)
- [ ] Login sin verificar email → 403 EMAIL_NOT_VERIFIED
- [ ] GET /auth/verify-email?token=... marca emailVerified=true
- [ ] Token consumido / inválido → 400 INVALID_VERIFICATION_TOKEN
- [ ] Token >24h → 400 VERIFICATION_TOKEN_EXPIRED
- [ ] POST /auth/resend-verification reenvía el link
- [ ] Logs de cada request incluyen tenantId/userId cuando hay sesión
- [ ] Headers sensibles (cookie/authorization) aparecen como `[REDACTED]` en logs

## 3.5 Rate limiting moderno (Redis-backed)

El sistema usa **rate limiting distribuido por email (login/register) e IP (general)**:

### 3.5.1 Configuración

```env
CACHE_ENABLED=true              # Habilita caching (y rate limit con Redis)
REDIS_URL=                       # Opcional; fallback a localhost:6379
NODE_ENV=production              # Rate limiting se activa solo en prod
```

> En desarrollo (`NODE_ENV=development`), `generalLimiter` está deshabilitado.
> Los limiters específicos (`loginLimiter`, `registerLimiter`) funcionan en ambos.

### 3.5.2 Límites actuales

| Endpoint            | Límite      | Ventana | Por qué (key)                |
| ------------------- | ----------- | ------- | ---------------------------- |
| POST /auth/login    | 5 intentos  | 15 min  | **Email** (anti brute-force) |
| POST /auth/register | 10 intentos | 1 hora  | **IP** (anti spam)           |
| Resto (general)     | 200 req     | 15 min  | **IP** (general)—solo prod   |

### 3.5.3 Testing en desarrollo

```bash
# 1. Arranca con NODE_ENV=development (default dev)
pnpm dev

# 2. El generalLimiter NO limita en dev, pero loginLimiter SÍ
# Intenta 6 veces login con el mismo email en <15 min:
for i in {1..6}; do
  curl -X POST http://localhost:3001/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@acme.com","password":"password123"}' \
    | jq .
  echo "Intento $i complete"
done

# Los primeros 5 darán 401 o 200 (si password es correcta);
# el 6to dará 429 RATE_LIMIT_EXCEEDED con Retry-After header.
```

### 3.5.4 Testing en producción (o forzando)

```bash
# Para forzar rate limit general en dev, temporalmente:
NODE_ENV=production pnpm dev

# Luego:
for i in {1..201}; do
  curl http://localhost:3001/categories -s -o /dev/null -w "%{http_code}\n"
done
# Verá 200 los primeros 200, 429 el 201.
```

### 3.5.5 Response headers

Cuando está limitado, la respuesta incluye:

```json
{
  "error": {
    "message": "Demasiadas solicitudes. Por favor intenta de nuevo más tarde.",
    "code": "RATE_LIMIT_EXCEEDED",
    "retryAfter": 420
  }
}
```

Y headers HTTP:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 420
RateLimit-Limit: 5
RateLimit-Remaining: 0
RateLimit-Reset: <unix-timestamp>
```

### 3.5.6 Con Redis fallido (graceful degradation)

Si Redis no está disponible, el middleware logguea y fallback a **in-memory store**:

```
WARN: redis unavailable, rate limiting will use in-memory store
```

Rate limiting sigue funcionando, pero solo en proceso (no distribuido).

## 4. Si algo falla

- Verificá que la migración corrió: `pnpm exec prisma migrate status`
- Que el client está regenerado: `pnpm exec prisma generate`
- Inspeccioná el JWT en jwt.io — `tenantId` debe estar en el payload
- Mirá los logs del server para el código de error específico
