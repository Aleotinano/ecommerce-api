# Deploy en producción

Deploy sobre **una sola máquina** que corre el stack entero con
`docker-compose.prod.yml`: Postgres + Redis + backend. Es el mismo compose de
siempre, no una arquitectura distinta — lo que cambia respecto de dev está en
[§Qué cambia entre dev y prod](#qué-cambia-entre-dev-y-prod).

La máquina de referencia es un **mini PC casero** (Intel Celeron J1900, 4 GB de
RAM, disco mecánico) con Ubuntu Server 24.04 sin GUI, y se expone a internet con
**Tailscale Funnel**. Los pasos son los mismos en cualquier Linux con Docker.

> [!important] Por qué Funnel y no un reverse proxy propio
> La conexión es hogareña y probablemente esté detrás de **CGNAT**: no hay IP
> pública que apuntar ni puertos que abrir en el router, así que un Caddy o un
> nginx propio no tendrían por dónde recibir tráfico. Funnel resuelve las tres
> cosas de una: sale por conexión saliente (el CGNAT deja de importar), termina
> el TLS y emite el certificado solo.
>
> Lo que se paga: **un nodo de Tailscale es un solo hostname**. No hay
> subdominio por tienda, así que el multi-tenant va enteramente por el header
> `X-Tenant-Slug` — ver [§Multi-tenant sin subdominios](#6-multi-tenant-sin-subdominios),
> que es el punto que hay que tener claro antes de empezar.

---

## Requisitos previos

| Qué | Detalle |
|---|---|
| Una cuenta de Tailscale | El tier gratis alcanza. Funnel hay que **habilitarlo explícitamente** en la tailnet, ver paso 2 |
| Docker Engine + `docker compose` | En la máquina, no en un contenedor |
| El repo con `pnpm-lock.yaml` commiteado | Ver [§El lockfile](#el-lockfile-tiene-que-estar-en-git) |

**No hace falta**: dominio propio, registro DNS, certificado, puertos abiertos en
el router, ni IP pública.

### Sobre la máquina

4 GB de RAM compartidos entre Postgres, Redis, Node y el sistema. Hoy ningún
servicio tiene límite de memoria declarado en el compose: si el stack empieza a
apretar, ese es el primer lugar a mirar (`mem_limit` por servicio y
`NODE_OPTIONS=--max-old-space-size` en el backend).

El disco es mecánico, así que **el build es la parte lenta**, no el runtime. La
rotación de logs ya está puesta en el compose (`10m` × 3 por servicio); sin eso el
driver `json-file` crece sin techo.

`argon2` es la única dependencia nativa del proyecto y trae prebuild para
`linux-x64` **musl** (`node_modules/argon2/prebuilds/linux-x64/argon2.musl.node`),
que es exactamente la combinación de `node:24-alpine` en esta máquina. No compila
nada.

Con cortes de luz ocasionales, los servicios llevan `restart: always`: dejá el
demonio de Docker habilitado al boot (`sudo systemctl enable docker`) y el stack
vuelve solo.

## 1. Instalar Docker

```bash
sudo apt update && sudo apt install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER" && newgrp docker
```

## 2. Tailscale y Funnel

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Funnel no viene habilitado por defecto: hay que darle a este nodo el atributo
`funnel` en la ACL de la tailnet, desde la consola de administración de
Tailscale. Si falta, el comando del paso 4 falla con un mensaje que dice
exactamente eso y linkea a dónde habilitarlo.

Anotá el hostname que te queda, que es la URL pública de la API:

```bash
tailscale status --json
```

El `DNSName` sale con la forma `<tu-host>.<tailnet>.ts.net`. **Ese valor va a
`BASE_URL`** en el paso siguiente, y tiene que coincidir carácter por carácter.

## 3. Clonar y configurar

```bash
git clone <tu-repo> e-commerce-express && cd e-commerce-express
cp .env.example .env
openssl rand -hex 24
openssl rand -hex 32
```

Editá `.env`. Lo mínimo que **tiene** que cambiar respecto del ejemplo:

```ini
NODE_ENV=production
BASE_URL=https://<tu-host>.<tailnet>.ts.net
ORIGINS=https://panel.midominio.com,https://tienda.midominio.com

SECRET_JWT_KEY=<algo largo y random>

POSTGRES_PASSWORD=<un hex de 24>
REDIS_PASSWORD=<otro hex de 24>
SECRET_ENC_KEY=<un hex de 32>
```

> [!warning] Las passwords, en hex
> `REDIS_PASSWORD` viaja dentro de `REDIS_URL`. Una password con `@` o `/` rompe
> el parseo de la URL y el backend arranca sin cache, en silencio. `openssl rand
> -hex` no genera esos caracteres; un gestor de passwords sí.
>
> Y un `$` es peor, porque falla más lejos: compose **interpola** `$VAR` dentro de
> `.env`, así que una password con `$` llega mutilada al contenedor y el síntoma
> es "la password es incorrecta" con la password bien escrita en el archivo. Si
> necesitás un `$` literal, se escribe `$$`. El `.env` de desarrollo de este repo
> ya tiene un valor así: `docker compose config` lo avisa con un
> `variable is not set. Defaulting to a blank string`.

`DATABASE_URL`, `REDIS_URL`, `PORT`, `NODE_ENV` y `TRUST_PROXY` **los pisa el
compose**: lo que pongas en `.env` para esas cinco no se usa en producción.

> [!important] `BASE_URL` tiene que ser **exactamente** el host por el que entran
> las requests
> No es cosmético ni sólo para armar links: de ahí sale el host que el resolutor
> de tenant descarta como "esto es la API, no una tienda". El hostname de Funnel
> tiene cuatro labels, así que si `BASE_URL` no coincide, `<tu-host>` se lee como
> slug de tenant y **todo `/store/*` contesta `TENANT_NOT_FOUND`** — el catálogo,
> el carrito, el checkout y el chat — mientras el panel admin sigue funcionando
> normal. Es el síntoma más confuso que tiene este backend.
>
> Sin barra final. Ver `docs/ARCHITECTURE.md` §Multi-tenancy.

> [!warning] `ORIGINS` es obligatoria acá y el arranque falla sin ella
> Es el CSV con **todos** los orígenes de browser. Vacía no degrada nada: rechaza
> *todas* las requests por CORS. Antes la app arrancaba igual y el síntoma era un
> panel entero muerto sin ninguna pista, así que ahora el contenedor directamente
> no levanta y el mensaje dice qué falta.
>
> El **storefront también va acá**, con el dominio de **cada** tienda. Que
> `routes/store/index.js` monte `storeCors()` —que acepta cualquier origen— no lo
> exime: el CORS global de `app.js` corre **antes**, y no se limita a no emitir
> headers, contesta **403 `CORS_ORIGIN_NOT_ALLOWED`**. O sea que la request muere
> antes de entrar al router de `/store`, y `storeCors()` sólo termina agregando
> `Authorization` a los headers expuestos. Olvidarse un dominio da el mismo perfil
> de falla que `BASE_URL` mal: **panel funcionando, tienda muerta**.
>
> La barra final se descarta sola (`https://panel.com/` = `https://panel.com`),
> que era el error de configuración más fácil de cometer y más difícil de ver.

> [!caution] `ORIGINS` es también la defensa de CSRF — no es una lista de lectura
> La cookie de sesión del panel es `SameSite=None` en producción, y no puede ser
> otra cosa: el panel vive en un dominio y la API en otro, así que con `Strict` el
> browser no la manda nunca y el login no funciona (anda en dev porque ahí todo es
> localhost). Con `None`, lo que impide que un sitio cualquiera opere el panel con
> la sesión del admin es **esta lista**: un origen no listado se come 403 en el
> preflight, y la API sólo parsea JSON, así que un POST de formulario —el único
> que no preflightea— no llega con un body legible.
>
> Corolario operativo: **agregar un dominio acá es darle permiso de escritura
> sobre el panel.** No metas orígenes "por las dudas", y pensalo dos veces antes de
> agregar dominios de preview deployments, que son efímeros y públicos.

> [!caution] Detrás del rewrite de Vercel el síntoma es peor: catálogo que carga y
> carrito que no
> Con `browser → Vercel → Funnel → app` el browser habla *same-origin* contra
> Vercel, así que un **GET no lleva header `Origin`** y cae en la rama sin origen
> de `middleware/cors.js`: pasa igual, con `ORIGINS` mal configurada. Pero los
> **POST/PUT/DELETE sí mandan `Origin`** aun same-origin, y Vercel lo reenvía
> upstream. Si ese dominio no está en `ORIGINS`, el catálogo se ve perfecto y el
> carrito tira 403 — parece un bug de la tienda y no lo es.
>
> Verificalo con un POST real (no un GET) desde el dominio de Vercel antes de dar
> el deploy por bueno. Ver el paso 4.

## 4. Levantar y exponer

```bash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml run --rm migrate
docker compose -f docker-compose.prod.yml up -d
```

El backend publica en `127.0.0.1:3001` — sólo loopback, así que hasta acá no lo
alcanza nadie de la red de casa. Comprobalo antes de exponerlo:

```bash
curl http://127.0.0.1:3001/health
```

Recién ahora, el Funnel:

```bash
sudo tailscale funnel --bg 3001
```

Y la verificación de punta a punta:

```bash
curl https://<tu-host>.<tailnet>.ts.net/health
```

```bash
docker compose -f docker-compose.prod.yml ps
```

El backend tiene que figurar en `healthy`. Si queda en `unhealthy`, mirá los
logs: `docker compose -f docker-compose.prod.yml logs backend`.

Y la verificación de CORS, que `/health` **no** cubre: `curl` sin `Origin` cae en
la rama "no es un browser" y pasa siempre, así que hay que mandar el header a
mano, con el dominio exacto que va a usar el browser:

```bash
curl -i -X OPTIONS https://<tu-host>.<tailnet>.ts.net/store/cart \
  -H "Origin: https://tienda.midominio.com" \
  -H "Access-Control-Request-Method: POST"
```

**204** con un header `access-control-allow-origin` que repita ese dominio = está
en la lista. **403 `CORS_ORIGIN_NOT_ALLOWED`** = falta en `ORIGINS`. No toca
datos: el preflight lo contesta el middleware global, antes de cualquier router.
Repetilo por cada storefront y por el panel.

> [!note] Por qué el backend publica puerto y Postgres/Redis no
> Funnel corre en el **host** y no ve la red interna de compose, así que el
> backend tiene que publicar en el host para que lo alcance. El bind explícito a
> `127.0.0.1` es la mitad importante: lo llega `tailscaled` y nadie más. Un
> `"3001:3001"` pelado lo abriría a toda la LAN.
>
> Postgres y Redis siguen sin `ports:` — se hablan por la red de compose. Un
> Redis alcanzable es RCE directa (`CONFIG SET dir` + `authorized_keys`).

## 5. Verificar `TRUST_PROXY` — una vez, mirando

El compose deja `TRUST_PROXY: "1"` asumiendo un salto (`tailscaled` agregando
`X-Forwarded-For`). **Confirmalo la primera vez**, porque si el número está mal,
`req.ip` es la IP equivocada y los cinco rate limiters de
`middleware/rateLimit.js` meten a todos los visitantes en el mismo balde — 200
req / 15 min compartidos entre toda la tienda.

Pegale al hostname público **desde fuera de la tailnet** (datos del celular, por
ejemplo) y buscá la línea que la app loguea **una sola vez**, en el primer request:

```bash
docker compose -f docker-compose.prod.yml logs backend | grep "cadena de proxies"
```

Sale algo así, y se lee entero:

```json
{"xForwardedFor":"203.0.113.7","hops":1,"reqIp":"203.0.113.7",
 "socketRemoteAddress":"127.0.0.1","trustProxy":1,...}
```

| Qué ves | Qué significa |
|---|---|
| `hops` = `trustProxy` y `reqIp` = la IP real | Está bien |
| `xForwardedFor` es `null` | **Funnel no propaga el header.** La IP real no llega nunca y ningún `TRUST_PROXY` lo arregla: hay que replantear el rate limiting |
| `hops` > `trustProxy` | Alguien sumó un salto (un rewrite de Vercel, típicamente). Subí el número |
| `reqIp` = `socketRemoteAddress` habiendo `xForwardedFor` | Express no está confiando en el header: `TRUST_PROXY` quedó corto |

Es una línea por proceso, así que si ya la pasaste, reiniciá el backend para
volver a verla.

Si la IP del request es la tuya real, `1` está bien. Si aparece una interna de
Tailscale (rango `100.64.0.0/10`), subí el número.

> [!important] `1` vale mientras el front le pegue **directo** al Funnel
> Hoy no hay rewrite de Vercel: el browser llama al hostname del Funnel, así que
> hay un solo salto. Si algún día se agrega un rewrite, Vercel proxea server-side y
> pasan a ser **dos** — con `1`, Express devuelve la IP del servidor de Vercel como
> si fuera la del visitante y los limiters cuentan a todo el planeta como un
> cliente. Verificalo de nuevo **con la cadena completa armada**: medirlo antes de
> que exista el proxy da un falso positivo, porque con un salto `1` parece
> correcto igual.
>
> | Topología | `TRUST_PROXY` |
> |---|---|
> | Local, sin nada adelante | `0` |
> | `browser → Funnel → app` (hoy) | `1` |
> | `browser → Vercel (rewrite) → Funnel → app` | `2` |
>
> Queda un hecho **sin confirmar**: si Tailscale Funnel *agrega* su entrada a
> `X-Forwarded-For` o lo *pisa*. Si lo pisa, la IP real del visitante no llega
> nunca y ningún valor de `TRUST_PROXY` lo arregla — habría que resolver el rate
> limiting de otra forma.

> [!note] Tres rutas tienen dos techos, según quién llame
> `/store/config`, `/store/page` y `/order-statuses` las pide el **servidor** de
> Vercel en cada render (SSR), no el browser: llegan todas con la IP de egreso de
> Vercel. En el balde por IP del limiter general eso son ~13 renders por minuto
> para la tienda entera antes del 429, así que se saltean el general.
>
> No pueden compartir un solo techo, porque son dos poblaciones distintas: la IP de
> Vercel agrega a **todos** los visitantes de una tienda, y una IP cualquiera es
> **una persona**. Se separan por el header `Origin` —el fetch server-to-server de
> Next no lo manda, un browser cross-origin siempre sí— y cada request pasa por
> exactamente uno:
>
> | Población | Limiter | Clave | Techo / 15 min |
> |---|---|---|---|
> | SSR (sin `Origin`) | `ssrReadLimiter` | `<tenant>:<ip>` | 3000 |
> | Browser (con `Origin`) | `browserReadLimiter` | `<ip>` | 120 |
>
> Si agregás una ruta nueva que consuma el SSR, sumala a `SSR_PATHS` en
> `middleware/rateLimit.js` **y montale los dos limiters**, o vas a ver 429 sin
> explicación.
>
> Con `SSR_SHARED_SECRET` seteada en los dos lados, la separación deja de inferirse:
> sólo entra al balde de máquina quien mande ese secreto en `X-SSR-Key`. Vale la
> pena setearla por algo más que el curl — **si algún día se agrega un rewrite de
> Vercel, la heurística de `Origin` se da vuelta en silencio**: un GET same-origin
> del browser tampoco manda `Origin`, así que todo el tráfico de visitantes caería
> en el balde de máquina y el techo humano no se activaría nunca. El secreto no
> depende de eso.
>
> Del lado de Next la variable **no** puede llamarse `NEXT_PUBLIC_*`: esas se
> inlinean en el bundle del browser y el secreto viajaría a cada visitante.

## 6. Multi-tenant sin subdominios

Un nodo de Tailscale = un hostname, así que el diseño de subdominio-por-tenant
(`acme.midominio.com` → tenant `acme`) **no aplica en este deploy**. Todas las
tiendas se distinguen por el header:

```
X-Tenant-Slug: <slug>
```

El código ya lo soporta sin cambios: `middleware/tenant.js` resuelve por host y,
si el host es el de la API, cae al header. Lo que **no** es opcional es que el
frontend lo mande siempre — el storefront lo trata como invariante y falla antes
de hacer la request si no puede resolver el slug.

La única ruta que no necesita tenant es `/order-statuses`, y es a propósito: es
una tabla estática del sistema, sin datos de nadie.

Probalo con un tenant real antes de dar el deploy por bueno:

```bash
curl -H "X-Tenant-Slug: <slug-real>" https://<tu-host>.<tailnet>.ts.net/store/config
```

## 7. Crear el tenant y su admin

La imagen no lleva gestor de paquetes, así que los scripts se invocan con `node`
directo (no `pnpm`):

```bash
docker compose -f docker-compose.prod.yml exec backend node prisma/create-tenant.js
```

```bash
docker compose -f docker-compose.prod.yml exec backend node prisma/create-tenant.js --list
```

> [!danger] Nunca corras `prisma/seed.js` contra esta base
> Hace un **TRUNCATE completo** antes de sembrar. En el server con datos del
> cliente cargados, eso es la pérdida total.

## 8. MercadoPago y WhatsApp: no se configuran

**Los dos módulos quedan apagados en este deploy.** Están implementados desde el
principio del desarrollo, pero ningún tenant los usa: el cobro es en efectivo o
por transferencia (flujo manual, lo confirma una persona) y el canal con el
comprador es WhatsApp por fuera de la API.

Apagados no es un estado degradado, es el estado normal: **no pongas sus
credenciales en `.env` y listo.**

| Módulo | Cómo queda inactivo | Qué pasa si algo lo invoca |
|---|---|---|
| MercadoPago | sin `ACCESS_TOKEN` | `MERCADOPAGO_NOT_CONFIGURED` (503) al crear una preferencia. El resto de la app arranca y funciona igual |
| WhatsApp | sin `WHATSAPP_APP_SECRET` / `WHATSAPP_ACCESS_TOKEN` | el webhook responde inactivo; ya estaba diseñado así |

No hay nada que registrar en Meta ni en MercadoPago, y **el catálogo, las órdenes,
la caja y el storefront no dependen de ninguno de los dos**: el modelo de datos ya
tiene el camino manual completo (`paymentConfirmedById`, `MANUAL_CHANNELS =
["CASH", "TRANSFER"]`, y el módulo de caja ignorando el canal `GATEWAY`).

Para prenderlos más adelante alcanza con cargar las credenciales en `.env` y
reiniciar: el código sigue ahí, no se borró nada. Ahí sí van estas URLs:

| Proveedor | URL |
|---|---|
| MercadoPago — webhook | `https://<tu-host>.<tailnet>.ts.net/mercadopago/webhook` |
| MercadoPago — `back_url` | `https://<tu-host>.<tailnet>.ts.net/mercadopago/{success,failure,pending}` |
| WhatsApp (Meta) | `https://<tu-host>.<tailnet>.ts.net/webhooks/whatsapp` (GET verify + POST) |

> [!note] El arreglo de CORS sigue haciendo falta igual
> Aunque no haya webhooks, el `HEALTHCHECK` del Dockerfile también llega sin
> header `Origin` — y con el bug viejo dejaba el contenedor `unhealthy` para
> siempre. Ver [§Qué cambia entre dev y prod](#qué-cambia-entre-dev-y-prod);
> `tests/production-mode.test.js` lo cubre.

## 9. Backups

```bash
chmod +x scripts/backup-db.sh
```

```bash
crontab -e
```

```cron
0 3 * * * /home/<usuario>/e-commerce-express/scripts/backup-db.sh >> /home/<usuario>/backup.log 2>&1
```

Restaurar:

```bash
gzip -dc backups/ecommerce-20260811-030000.sql.gz | docker compose -f docker-compose.prod.yml exec -T postgres psql -U ecommerce -d ecommerce
```

> [!danger] Los backups viven en la misma máquina que la base
> `scripts/backup-db.sh` deja los `.sql.gz` en `backups/`, en este mismo disco.
> Con una sola máquina, disco mecánico y cortes de luz, eso no es un backup: es
> una copia que se pierde junto con el original. **Copialos afuera** — otra
> máquina de la tailnet es lo más directo, porque la red ya está.

> [!important] Un backup que nunca se restauró no es un backup.
> Probá la restauración una vez, contra una base descartable, antes de confiar en
> el cron.

---

## Actualizar el deploy

```bash
git pull
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml run --rm migrate
docker compose -f docker-compose.prod.yml up -d
```

Parchear las imágenes base (los tags son flotantes):

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml build --pull
docker compose -f docker-compose.prod.yml up -d
```

El Funnel no hay que volver a levantarlo: `--bg` lo deja persistido y sobrevive a
los reinicios del contenedor y de la máquina.

---

## Qué cambia entre dev y prod

`docker-compose.prod.yml` **no es un override** de `docker-compose.yml`, y no
puede serlo: compose *mergea* las listas `ports:`, así que un override no tiene
forma de despublicar un puerto que el archivo base publica — y despublicar es
justamente lo que hay que hacer.

| | dev (`docker-compose.yml`) | prod (`docker-compose.prod.yml`) |
|---|---|---|
| Postgres | puerto `5432` en `0.0.0.0`, password `ecommerce` | sin `ports:`, password de `.env` |
| Redis | puerto `6379` en `0.0.0.0`, **sin password** | sin `ports:`, `--requirepass` |
| Backend | puerto `3001` en `0.0.0.0` | `127.0.0.1:3001`, alcanzable sólo por `tailscaled` |
| TLS | no hay | Tailscale Funnel, certificado automático |
| Tenant | header o subdominio | **sólo** header `X-Tenant-Slug` |
| `TRUST_PROXY` | `0` | `1` (un salto: Funnel) — verificar, ver paso 5 |
| Logs | sin límite | rotación `10m` × 3 |

### Lo que había que arreglar para que esto funcionara

Nada de esto se manifestaba en desarrollo — `NODE_ENV=production` es un modo que
nadie corre en local, así que ninguno de estos caminos se ejercitaba nunca:

1. **Requests sin `Origin` se rechazaban con 500.** `middleware/cors.js` trataba
   la ausencia de `Origin` como un origen no permitido cuando `NODE_ENV=production`.
   Pero una request sin `Origin` no es cross-origin: es curl, el `HEALTHCHECK` del
   Dockerfile, una navegación top-level del browser o un webhook server-to-server.
   Efecto: **el contenedor quedaba `unhealthy` para siempre** — eso pasa con o sin
   webhooks configurados, porque el healthcheck es parte de la imagen. Ahora pasan
   sin emitir headers de CORS. Lo que frena CSRF acá es `sameSite: "strict"` en la
   cookie, no ese filtro.

2. **No había `app.set("trust proxy")`.** Detrás de un proxy, `req.ip` era la IP
   del proxy, así que los cinco rate limiters de `middleware/rateLimit.js` metían a
   todos los visitantes en un mismo balde — 200 req / 15 min **compartidos entre
   toda la tienda**. Ahora sale de `TRUST_PROXY`. Ojo con el tipo: Express
   interpreta un string como *lista de IPs*, no como cantidad de saltos, por eso
   `config.js` lo convierte a número.

3. **El lockfile estaba en `.gitignore`.** Ver abajo.

4. **Un origen rechazado devolvía 500.** `callback(new Error(...))` sin
   `statusCode` caía a 500, y en producción el `errorHandler` enmascara los 500
   como `"Error interno del servidor"` / `INTERNAL_ERROR`. O sea: el error de
   configuración más fácil de arreglar *si te lo dicen* llegaba al front sin
   ninguna pista. Ahora es **403 `CORS_ORIGIN_NOT_ALLOWED`**.

5. **Los 4xx se logueaban como `error`.** Con el 403 puesto, la línea de log
   seguía saliendo en el mismo nivel que una caída de la base — y cada 404 de
   `notFoundHandler` también. `middleware/errorHandler.js` ahora elige el nivel
   por status: `warn` para 4xx, `error` para 5xx. Es el único cambio que toca
   todos los errores y no sólo CORS.

6. **`ORIGINS` vacía en prod rechazaba todo el panel, y la app arrancaba igual.**
   Ahora es obligatoria y el arranque falla si falta (ver el paso 3). De paso, la
   barra final se normaliza: `https://panel.com/` nunca hubiera matcheado, porque
   el header `Origin` del browser no la lleva.

7. **El preflight no se cacheaba.** Sin `maxAge`, el browser repetía el `OPTIONS`
   en cada request no-simple. Ahora ambos `cors()` mandan `Access-Control-Max-Age`.

8. **El host de la API se leía como slug de tenant.** `IGNORED_SUBDOMAINS` es una
   lista de tres nombres (`www`/`api`/`app`) y el subdominio le gana al header, así
   que cualquier dominio de ≥3 labels fuera de esa lista rompía **todo `/store/*`**
   con `TENANT_NOT_FOUND`, con el panel admin funcionando normal al lado. Ahora el
   host propio se descarta comparando contra `BASE_URL` (ver el aviso del paso 3).
   Con Funnel esto importa más que nunca: su hostname tiene cuatro labels.

Los primeros siete están cubiertos por `tests/production-mode.test.js`; el octavo,
por `tests/tenant-host-resolution.test.js`.

### El lockfile tiene que estar en git

El `Dockerfile` hace `COPY package.json pnpm-lock.yaml ./` y
`pnpm install --frozen-lockfile`. Con `pnpm-lock.yaml` ignorado, un `git clone`
en el server no lo tiene y **el build falla en el `COPY`**. Además, un lockfile
ausente vuelve `--frozen-lockfile` decorativo: cada build resolvería versiones
distintas, y "anda en mi máquina" deja de ser una broma.
