# Testeo desde localhost — configuración y riesgo

Qué hay que tocar en el backend para que el front corra en la máquina de desarrollo contra
la API de producción, **y qué se está aceptando al hacerlo**. La contraparte para el front
es `front-md-guia/FRONTEND_LOCAL_CONTRA_PRODUCCION.md`.

---

## 1. Estado del deploy

Verificado de punta a punta el 2026-08-18, desde fuera de la tailnet:

| | |
|---|---|
| Funnel + TLS | `/health` 200 desde internet |
| `BASE_URL` | correcta — `/store/config` sin header da 400, no 404 |
| `TRUST_PROXY` | `1`, medido: Funnel agrega `X-Forwarded-For` con `hops:1` |
| CORS | 403 a orígenes ajenos, 204 a los listados |
| Redis | `connected` + `ready` (no degradó a memoria) |
| Tenant | `pastaia`, `tenantId` 1, 15 productos / 111 variantes |
| Logs | registran la IP real del cliente, IPv4 e IPv6 |

---

## 2. Por qué hace falta tocar algo

Con `NODE_ENV=production`, la rama de `middleware/cors.js` que acepta cualquier origen de
localhost está apagada:

```js
if (!isProd && isLocalhostOrigin(origin)) return callback(null, true);
```

Así que cada origen de desarrollo tiene que estar **listado explícitamente** en `ORIGINS`,
igual que un dominio real. No hay término medio: o está en la lista, o se come
403 `CORS_ORIGIN_NOT_ALLOWED` en el preflight.

---

## 3. ¿Es seguro poner localhost en `ORIGINS`?

**Depende de cuál de las dos apps**, y la diferencia es grande. No es la misma pregunta
para el storefront que para el panel.

### 3.1 El storefront: sí, es seguro

El storefront **no usa cookies**. Autentica con `Authorization: Bearer <token>`, que el
front guarda y adjunta a mano. Un sitio atacante no puede hacer que el browser mande ese
token: no viaja solo, y la política de mismo origen le impide leerlo del `localStorage` de
otro origen.

Agregar `http://localhost:3000` a `ORIGINS` para el storefront no abre ningún vector nuevo.

### 3.2 El panel: acá está el riesgo real

La cookie de sesión del panel es `httpOnly; Secure; SameSite=None` — y **no puede ser otra
cosa**, porque el panel y la API viven en dominios distintos y con `Strict` el browser no la
manda nunca.

Con `SameSite=None`, lo único que impide que un sitio cualquiera opere el panel con la
sesión del admin es **la lista de `ORIGINS`**. De ahí el corolario que ya está escrito en
`DEPLOY.md`: **agregar un origen a esa lista es darle permiso de escritura sobre el panel.**

El vector concreto de un `http://localhost:3000` listado:

1. El admin tiene sesión abierta en el panel (la cookie vive en su browser)
2. Cualquier cosa que corra en `localhost:3000` de **su máquina** puede hacer requests
   autenticadas contra la API de producción, y el browser adjunta la cookie sola
3. `localhost:3000` es el puerto por default de casi todo — otro proyecto, una demo que
   clonaste, un paquete de npm que levanta un server

No hace falta un atacante remoto sofisticado: alcanza con levantar el proyecto equivocado
en el puerto de siempre.

### 3.3 Cómo se maneja

Tres medidas, de más a menos importante:

**a. Un origen dedicado para el panel, no `localhost:3000`.**

```
http://panel.localhost:4310
```

Sigue siendo contexto seguro —Chrome trata todo `*.localhost` como confiable, así que la
cookie `Secure` funciona— pero **nada más va a ocupar ese origen por accidente**. Elimina
el vector realista sin costo alguno.

> No sirve un dominio inventado tipo `http://panel.test:4310`: no es contexto seguro, el
> browser descarta la cookie `Secure` y el login no funciona nunca. Tiene que ser
> `localhost`, `127.0.0.1` o un subdominio de `localhost`.

**b. Sacarlos cuando entren los dominios reales.** Estos orígenes son andamio de la fase de
testeo, no configuración permanente. En cuanto el panel esté en Vercel, salen.

**c. Cerrar sesión del panel cuando no lo estés usando.** Sin cookie activa no hay nada que
un origen listado pueda aprovechar.

### 3.4 Qué NO alcanza

- **No** sirve confiar en que `storeCors()` acepta cualquier origen: el CORS global de
  `app.js` corre antes y contesta 403 primero. La request muere ahí.
- **No** sirve poner un comodín. `middleware/cors.js` compara por igualdad exacta contra la
  lista; no hay patrones, y está bien que no los haya.

---

## 4. La configuración

En el `.env` del server, `ORIGINS` es un CSV sin espacios:

```ini
ORIGINS=http://localhost:3000,http://panel.localhost:4310
```

Y cuando entren los dominios reales, esa lista pasa a ser sólo:

```ini
ORIGINS=https://panel.midominio.com,https://tienda.midominio.com
```

Aplicar los cambios:

```bash
docker compose -f docker-compose.prod.yml up -d --force-recreate backend
```

`ORIGINS` se lee al arrancar, así que un cambio en `.env` no tiene efecto sin recrear el
contenedor. No hace falta rebuildear: la variable entra por `env_file`, no por la imagen.

> [!warning] Antes de editar el `.env` del server
> No hagas `cp .env .env.bak`. El `.gitignore` ya cubre el patrón `.env*` desde el
> 2026-08-18, pero el hábito es el que causa el problema: los bots piden `/.env.bak`
> justamente porque la gente lo crea. Si necesitás una copia, guardala **fuera** del
> directorio del repo.

Verificar, con el origen exacto que va a usar el browser:

```bash
curl -i -X OPTIONS https://micahost.tail4e0ff0.ts.net/store/cart -H "Origin: http://localhost:3000" -H "Access-Control-Request-Method: POST"
```

**204** con `access-control-allow-origin` repitiendo ese dominio = está en la lista.
**403** = falta. Repetir por cada origen.

---

## 5. Cómo revertir

Es una línea del `.env` y un recreate. No hay migración ni estado que deshacer:

```ini
ORIGINS=https://panel.midominio.com,https://tienda.midominio.com
```

```bash
docker compose -f docker-compose.prod.yml up -d --force-recreate backend
```

Comprobá que quedó cerrado — esto **tiene** que dar 403:

```bash
curl -i -X OPTIONS https://micahost.tail4e0ff0.ts.net/store/cart -H "Origin: http://localhost:3000" -H "Access-Control-Request-Method: POST"
```

---

## 6. Pendientes del backend, por prioridad

### 6.1 Backups — lo más urgente

Hasta ahora la base estaba vacía; desde el seed de `pastaia` ya no. `scripts/backup-db.sh`
existe pero deja los `.sql.gz` en `backups/`, **en el mismo disco mecánico de la misma
máquina** que puede quedarse sin luz. Eso no es un backup: es una copia que se pierde junto
con el original.

```bash
chmod +x scripts/backup-db.sh
```

```cron
0 3 * * * /home/aleodev/cori-api/scripts/backup-db.sh >> /home/aleodev/backup.log 2>&1
```

Y lo que falta de verdad: **copiarlos afuera**. Otra máquina de la tailnet es lo más
directo, porque la red ya está. Un backup que nunca se restauró tampoco es un backup —
probá la restauración una vez contra una base descartable.

### 6.2 Los stack traces de los 404 llenan la rotación — hecho

`middleware/errorHandler.js` pasaba el objeto `err` completo al logger también en los 4xx.
En un 404 de ruta inexistente el stack son 8 líneas que siempre dicen lo mismo
(`notFoundHandler` y el router de Express): cero información, ~1,5 KB por request. Con el
hostname público recibiendo escaneo automatizado constante, esa basura iba empujando los
logs útiles fuera de la ventana de rotación (10 MB × 3) — justo ahora que el logger
registra la IP real y sirven para investigar.

El stack quedó reservado para los 5xx. De un 4xx se loguea el mensaje y, cuando existe,
`details`: es lo que arma zod en un 400 de validación y dice qué campo falló, así que un
400 real sigue siendo investigable mientras que un 404 de bot queda en una línea. La clave
del log sigue siendo `err`, así que `err.message` no se movió de lugar.

No cambia ninguna respuesta HTTP: el 404 sigue contestando lo mismo. Lo fija
`tests/error-handler.test.js`.

### 6.3 Datos de contacto de `pastaia`

`contactPhone` y `contactAddress` sin cargar — el seed lo avisa al terminar. Se cargan desde
el panel, no hace falta re-sembrar.

### 6.4 Endpoints públicos enumerables — decisión, no bug

`GET /tenant-config/:tenantId` y `GET /tenant-attributes/:tenantId` usan `attachUser`, que
no exige token. **No filtran secretos**: la proyección excluye `whatsappAccessToken`,
`cloudinaryApiKey` y `cloudinaryApiSecret`. Pero el `tenantId` es un entero secuencial, así
que cualquiera puede iterar y listar nombre, tema y métodos de pago de todas las tiendas.

Con un solo tenant no tiene consecuencia. Cuando haya varios clientes en la misma máquina,
vale decidir si se cierra — y hay que mirar el panel antes, porque puede depender de que sea
público.
