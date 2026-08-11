# Deploy en producción

Deploy sobre **una VM** que corre el stack entero con `docker-compose.prod.yml`:
Postgres + Redis + backend + Caddy (TLS). Es el mismo compose de siempre, no una
arquitectura distinta — lo que cambia respecto de dev está en
[§Qué cambia entre dev y prod](#qué-cambia-entre-dev-y-prod).

El proveedor de referencia es **Oracle Cloud Always Free**, porque es el único
tier gratuito de 2026 que da una VM real, no duerme y no expira. Los pasos son
los mismos en cualquier VM Linux con IP pública (GCP `e2-micro`, un VPS de €4).

> [!important] Por qué una VM y no un PaaS gratuito
> Con los webhooks apagados (ver paso 8) no hay ningún cliente automático que se
> desuscriba por timeout, así que un PaaS que duerme **no queda descartado de
> plano**. Quedan tres razones, más flojas pero suficientes:
>
> 1. **El cold start lo pagan personas.** Los free tiers de PaaS duermen a los 15
>    minutos y despiertan en ~50 s. Eso lo come el comprador que abre la tienda y
>    —peor— el mostrador esperando para cobrar en el módulo de caja.
> 2. **Igual habría que partir el stack.** El Postgres gratis de Render expira a
>    los 30 días y su Redis no tiene tier gratis, así que el camino PaaS son tres
>    proveedores (Render + Neon + Upstash), tres cuentas y ningún `docker compose`.
> 3. **Una VM no expira ni duerme**, y los datos del cliente son tuyos.
>
> Si el piloto se volviera una demo sin uso real, el cálculo cambia y Render +
> Neon + Upstash es menos trabajo. Hoy no es el caso.

---

## Requisitos previos

| Qué | Detalle |
|---|---|
| Cuenta Oracle Cloud | Pide tarjeta **para verificar identidad**; el tier Always Free no cobra. Verificá que la cuenta quede como *Always Free* y no como *Pay As You Go* |
| Un dominio | Necesario para el certificado TLS. Si no tenés, sirve un subdominio gratis de DuckDNS — Let's Encrypt los emite sin problema |
| El repo con `pnpm-lock.yaml` commiteado | Ver [§El lockfile](#el-lockfile-tiene-que-estar-en-git) |

### Recursos Always Free (estado a agosto 2026)

Oracle **recortó el tier en junio de 2026, sin anuncio**: la cuota de Ampere A1
pasó de 4 OCPU / 24 GB a **2 OCPU / 12 GB**. Sigue siendo holgado para este stack
(Postgres + Redis con `maxmemory 256mb` + Node + Caddy).

---

## 1. Crear la VM

1. *Compute → Instances → Create instance*.
2. **Shape**: `VM.Standard.A1.Flex` (Ampere, ARM) con 2 OCPU / 12 GB.
3. **Imagen**: Ubuntu 24.04.
4. **Boot volume**: 50 GB alcanza y sobra (el Always Free da hasta 200 GB).
5. Guardá la clave SSH privada que te ofrece descargar: no hay segunda chance.

> [!tip] "Out of capacity"
> Es el error más común creando instancias ARM en Oracle: la región no tiene
> capacidad libre en ese momento. No es un problema de tu cuenta. Probá otro
> *availability domain* o reintentá más tarde.

**ARM no es un problema para esta imagen.** `argon2` —la única dependencia
nativa— publica prebuilds para `linux-arm64` **musl**
(`node_modules/argon2/prebuilds/linux-arm64/argon2.armv8.musl.node`), que es
exactamente la combinación de `node:24-alpine` en ARM. No compila nada.

## 2. Abrir los puertos (los dos lugares)

Este es el paso que más tiempo hace perder en Oracle, porque el firewall está
**dos veces** y abrir uno solo no alcanza.

**a) Security List de la VCN** (el firewall de Oracle, en la consola web):
*Networking → Virtual Cloud Networks → tu VCN → Security Lists → Default*.
Agregá dos *ingress rules* desde `0.0.0.0/0`: TCP **80** y TCP **443**.

**b) `iptables` dentro de la VM.** Las imágenes de Ubuntu de Oracle vienen con una
regla `REJECT` que descarta todo lo que no sea SSH. Sin esto, el puerto está
abierto en la consola y la conexión igual muere:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## 3. Instalar Docker

```bash
sudo apt update && sudo apt install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER" && newgrp docker
```

## 4. DNS

Apuntá un registro **A** de tu dominio a la IP pública de la VM y esperá a que
propague. Caddy pide el certificado por el desafío HTTP-01, que exige que el
dominio ya resuelva a esta IP: **si no resolvió todavía, el primer arranque
falla** y Let's Encrypt cuenta ese intento contra el límite semanal.

Comprobalo antes de seguir:

```bash
dig +short api.midominio.com   # tiene que devolver la IP de la VM
```

## 5. Clonar y configurar

```bash
git clone <tu-repo> e-commerce-express && cd e-commerce-express
cp .env.example .env
openssl rand -hex 24   # POSTGRES_PASSWORD
openssl rand -hex 24   # REDIS_PASSWORD
openssl rand -hex 32   # SECRET_ENC_KEY
```

Editá `.env`. Lo mínimo que **tiene** que cambiar respecto del ejemplo:

```ini
NODE_ENV=production
BASE_URL=https://api.midominio.com
ORIGINS=https://panel.midominio.com

SECRET_JWT_KEY=<algo largo y random>

POSTGRES_PASSWORD=<el hex de arriba>
REDIS_PASSWORD=<el otro hex de arriba>
DOMAIN=api.midominio.com
ACME_EMAIL=vos@midominio.com
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
> de tenant descarta como "esto es la API, no una tienda". Si `BASE_URL` no
> coincide con el host real, el primer label del dominio se lee como slug de
> tenant y **todo `/store/*` contesta `TENANT_NOT_FOUND`** — el catálogo, el
> carrito, el checkout y el chat — mientras el panel admin sigue funcionando
> normal. Es el síntoma más confuso que tiene este backend.
>
> Con un subdominio de DuckDNS (`micomercio.duckdns.org`) esto es la diferencia
> entre una tienda que anda y una que no existe. Ver `docs/ARCHITECTURE.md`
> §Multi-tenancy.

> [!warning] `ORIGINS` es obligatoria acá y el arranque falla sin ella
> Es el CSV de orígenes del **panel admin**. Vacía no degrada nada: rechaza
> *todas* sus requests por CORS. Antes la app arrancaba igual y el síntoma era un
> panel entero muerto sin ninguna pista, así que ahora el contenedor directamente
> no levanta y el mensaje dice qué falta.
>
> El **storefront no va acá**: `/store/*` acepta cualquier origen a propósito,
> porque cada tienda vive en su propio dominio. La barra final se descarta sola
> (`https://panel.com/` = `https://panel.com`), que era el error de configuración
> más fácil de cometer y más difícil de ver.

## 6. Levantar

```bash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml run --rm migrate   # migraciones
docker compose -f docker-compose.prod.yml up -d
```

Verificar:

```bash
curl https://api.midominio.com/health          # {"status":"ok"}
docker compose -f docker-compose.prod.yml ps   # backend en "healthy"
```

Si el backend queda en `unhealthy`, mirá los logs: `docker compose -f
docker-compose.prod.yml logs backend`.

## 7. Crear el tenant y su admin

La imagen no lleva gestor de paquetes, así que los scripts se invocan con `node`
directo (no `pnpm`):

```bash
docker compose -f docker-compose.prod.yml exec backend node prisma/create-tenant.js
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
| MercadoPago — webhook | `https://api.midominio.com/mercadopago/webhook` |
| MercadoPago — `back_url` | `https://api.midominio.com/mercadopago/{success,failure,pending}` |
| WhatsApp (Meta) | `https://api.midominio.com/webhooks/whatsapp` (GET verify + POST) |

> [!note] El arreglo de CORS sigue haciendo falta igual
> Aunque no haya webhooks, el `HEALTHCHECK` del Dockerfile también llega sin
> header `Origin` — y con el bug viejo dejaba el contenedor `unhealthy` para
> siempre. Ver [§Qué cambia entre dev y prod](#qué-cambia-entre-dev-y-prod);
> `tests/production-mode.test.js` lo cubre.

## 9. Backups

```bash
chmod +x scripts/backup-db.sh
crontab -e
```

```cron
0 3 * * * /home/ubuntu/e-commerce-express/scripts/backup-db.sh >> /home/ubuntu/backup.log 2>&1
```

Restaurar:

```bash
gzip -dc backups/ecommerce-20260811-030000.sql.gz \
  | docker compose -f docker-compose.prod.yml exec -T postgres psql -U ecommerce -d ecommerce
```

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
| Backend | puerto `3001` publicado | sólo `expose`, alcanzable únicamente por Caddy |
| TLS | no hay | Caddy, certificado automático de Let's Encrypt |
| `TRUST_PROXY` | `0` | `1` (un salto: Caddy) |
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

2. **No había `app.set("trust proxy")`.** Detrás de Caddy, `req.ip` era la IP del
   proxy, así que los cinco rate limiters de `middleware/rateLimit.js` metían a
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
   Ahora es obligatoria y el arranque falla si falta (ver el paso 5). De paso, la
   barra final se normaliza: `https://panel.com/` nunca hubiera matcheado, porque
   el header `Origin` del browser no la lleva.

7. **El preflight no se cacheaba.** Sin `maxAge`, el browser repetía el `OPTIONS`
   en cada request no-simple. Ahora ambos `cors()` mandan `Access-Control-Max-Age`.

8. **El host de la API se leía como slug de tenant.** `IGNORED_SUBDOMAINS` es una
   lista de tres nombres (`www`/`api`/`app`) y el subdominio le gana al header, así
   que cualquier dominio de ≥3 labels fuera de esa lista rompía **todo `/store/*`**
   con `TENANT_NOT_FOUND`, con el panel admin funcionando normal al lado. Ahora el
   host propio se descarta comparando contra `BASE_URL` (ver el aviso del paso 5).

Los primeros siete están cubiertos por `tests/production-mode.test.js`; el octavo,
por `tests/tenant-host-resolution.test.js`.

### El lockfile tiene que estar en git

El `Dockerfile` hace `COPY package.json pnpm-lock.yaml ./` y
`pnpm install --frozen-lockfile`. Con `pnpm-lock.yaml` ignorado, un `git clone`
en el server no lo tiene y **el build falla en el `COPY`**. Además, un lockfile
ausente vuelve `--frozen-lockfile` decorativo: cada build resolvería versiones
distintas, y "anda en mi máquina" deja de ser una broma.

Si venís de antes de este cambio, el lockfile todavía no está commiteado:

```bash
git add pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "chore: versionar el lockfile, que el build de Docker necesita"
```

---

## Sobre la cuenta de Oracle

- **Recuperación por inactividad**: Oracle puede reclamar instancias Always Free
  con uso muy bajo de forma sostenida. Una tienda con tráfico real no califica,
  pero un deploy que queda meses sin visitas sí. Convertir la cuenta a *Pay As You
  Go* la exime, y los recursos Always Free se siguen sin cobrar (pero ahí sí, un
  recurso fuera de la cuota gratis se factura: cuidado con lo que creás).
- **Un solo huevo, una sola canasta**: esta VM es todo el deploy. Si la perdés,
  lo único que te salva son los backups del paso 9 — y los backups viven en la
  misma VM. Copialos afuera (`scp` a tu máquina, o a cualquier storage) si los
  datos del cliente importan.
