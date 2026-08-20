# La cookie del panel cross-site — cómo mirarla

El panel corre en `http://localhost:4001` y la API en el hostname del Funnel. Son **sitios
distintos**, así que la cookie de sesión es cross-site y puede morir en tres lugares
diferentes. Esta guía separa cuál.

El backend ya está del lado correcto: `controllers/users.js` emite la cookie con
`httpOnly`, `Secure` y `SameSite=None` en producción, sin `domain`, y el preflight vuelve
con `Access-Control-Allow-Credentials: true`. Si algo falla, falla del browser para acá.

---

## Antes de empezar

- Abrí DevTools **antes** de loguearte, en la pestaña **Network**.
- Tildá **Preserve log**, o el redirect posterior al login te borra la request que importa.
- **No uses ventana de incógnito.** Bloquea cookies de terceros por default: te da un falso
  negativo garantizado.

---

## Paso 1 — ¿el server la emitió?

Logueate y buscá la request de login en Network. Abrí la pestaña **Cookies** de esa request
(está al lado de Headers / Payload / Response) y mirá **Response Cookies**.

Esperado:

```
access_token   <valor>   Path=/   HttpOnly ✓   Secure ✓   SameSite=None
```

Usá esa pestaña y no la de Headers: es la única que además **marca en rojo las cookies que
el browser recibió pero descartó**, y te dice el motivo al pasar el mouse. Esa marca es
media respuesta al problema.

> Si no hay `Set-Cookie` en absoluto, el login no llegó a emitirla — mirá el status y el
> body de la respuesta antes de seguir. Nada de lo que sigue aplica.

---

## Paso 2 — ¿el browser la guardó?

**Application → Storage → Cookies**, y elegí el origen de la API:

```
https://micahost.tail4e0ff0.ts.net
```

> Acá es donde casi todos se confunden: la cookie **no** aparece bajo
> `http://localhost:4001`. Es una cookie del dominio de la API, no del panel. Buscarla en el
> origen equivocado hace parecer descartada una cookie que está perfectamente guardada.

- **Está** → seguí al paso 3.
- **No está** → el browser la descartó: paso 4.

---

## Paso 3 — ¿la manda en la request siguiente?

Provocá una request autenticada (recargar el panel alcanza; la que sirve es `/auth/me`).
En Network, esa request → pestaña **Cookies** → **Request Cookies**.

| Qué ves | Qué significa |
|---|---|
| `access_token` listada, respuesta 200 | Funciona. No hay nada que arreglar. |
| **No** listada, respuesta 401 | No se está mandando → falta `credentials: "include"` en el fetch |
| Listada, y aun así 401 | La cookie viaja: el problema es el token (expirado o firmado con otra `SECRET_JWT_KEY`), no el cross-site |

El caso del medio es el más común de todos. Y ojo: `credentials: "include"` tiene que estar
en **todas** las requests del panel, no sólo en la del login. Es típico que el login la
tenga y el resto no, y el síntoma es exactamente este — 200 al loguearse, 401 en la
siguiente.

---

## Paso 4 — si no se guardó, cuál de las dos causas es

**Señal directa:** Chrome pone un ícono de advertencia sobre la request en Network, y lo
detalla en **DevTools → Issues**. Un texto sobre *third-party cookies* o
*blocked due to Chrome's third-party cookie restrictions* cierra el caso: es el bloqueo de
cookies de terceros.

**Prueba decisiva, si el mensaje no es claro:** clickeá el ícono a la izquierda de la URL
(candado o deslizadores) → permití cookies de terceros para este sitio → recargá y volvé a
loguearte. Si con eso anda, era eso y nada más.

---

## Qué hacer con cada resultado

**Falta `credentials: "include"`.** Arreglo de una línea en el cliente HTTP del panel,
aplicado a todas las llamadas. Es un cambio del front; el backend no se toca.

**Bloqueo de cookies de terceros.** No se arregla desde la API: mientras el panel y la API
sean sitios distintos, el browser está en su derecho. Es el caso que resuelve el rewrite
`/backend/*` de Vercel, porque vuelve la request same-origin y la cookie deja de ser de un
tercero. Para seguir testeando hoy, la excepción por sitio del paso 4 alcanza.

---

## Lo que NO prueba nada

- **Que el catálogo del storefront cargue.** Lo renderiza el server, sin cookies ni CORS.
- **Que el login devuelva 200.** Sólo dice que usuario y contraseña estaban bien; la cookie
  puede haberse descartado después.
- **Que el preflight dé 204.** Es CORS, que es otra capa: un origen permitido igual puede
  quedarse sin cookie.

---

## Chequeo sin browser

Para confirmar que el server emite bien la cookie, sin browser de por medio (reemplazá las
credenciales, no las dejes escritas en ningún archivo):

```bash
curl -i -X POST https://micahost.tail4e0ff0.ts.net/auth/login -H "Content-Type: application/json" -H "Origin: http://localhost:4001" -d '{"email":"TU_EMAIL","password":"TU_PASSWORD"}' | grep -i "set-cookie\|access-control-allow-credentials"
```

Esperado: un `Set-Cookie` con `HttpOnly; Secure; SameSite=None` y el
`Access-Control-Allow-Credentials: true`. Si esto sale bien y el browser igual no la guarda,
la causa está del lado del browser — o sea, paso 4.
