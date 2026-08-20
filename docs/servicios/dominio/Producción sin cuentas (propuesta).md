---
tags: [servicio, dominio/usuarios, propuesta]
estado: propuesta
ultima-revision: 2026-07-29
lado: backend
---

# Producción sin cuentas (propuesta)

> [!info] Qué es este documento
> El **plan de integración** de la decisión de producto tomada el 2026-07-29 y registrada en
> [[Usuarios y Auth]]: [[mesa dulce demo|Mesa Dulce]] opera sin registro ni login. Ahí está el *qué*
> y el *por qué*; acá está el *cómo*. Nada de esto está implementado todavía.

## El punto de partida

El código de cuentas funciona entero y no tiene nada malo. Lo que pasa es que **nadie lo usa**:

- **Los clientes compran como invitados.** El camino existe punta a punta —carrito con cookie
  `guestId` ([[Carrito]]), checkout sin sesión en `POST /store/orders`— y a cambio exige
  `contactName` y `contactPhone`. Ver `routes/store/orders.js`.
- **Los administradores reciben sus credenciales a mano.** Son pocos y los crea el dueño del
  producto. No hay autoservicio ni se busca que lo haya.

La consecuencia de fondo, que ya está escrita en [[Usuarios y Auth]] y conviene repetir: **no se
puede asumir que una orden tiene `userId`**, ni que el cliente puede volver a ver su historial, ni
que hay un email al que escribirle. Eso no es un caso borde, es el caso normal.

## Decisión 1 — Qué se apaga, y cómo

**Recomendación: un flag por tenant, no sacar los endpoints del router.**

`TenantConfig.customerAccountsEnabled` (`Boolean @default(true)`). En `false`, los endpoints de
cuentas de cliente responden 404. Los cuatro candidatos están en `routes/store/auth.js`:

| Endpoint | Con el flag en `false` |
|---|---|
| `POST /store/auth/register` | 404 |
| `GET /store/auth/verify-email` | 404 |
| `POST /store/auth/resend-verification` | 404 |
| `POST /store/auth/login` | 404 |
| `GET /store/auth/me` | se deja vivo (responde 401 sin token, como siempre) |

Por qué flag y no borrar: `acme` y `shopco` siguen usando cuentas, y apagar globalmente obliga a un
deploy para volver atrás. Además el costo de sumar el campo es mínimo — el whitelist y el `select`
de [[TenantConfig]] ya se derivan del schema Zod, así que alcanza con tocar `prisma/schema.prisma` y
`schemas/tenant-config.schema.js`.

**`routes/users.js` (el backoffice) no se toca.** Es por donde entra el admin; apagarlo deja al
tenant sin panel.

> [!warning] Ojo con el precedente de `allowCartGuest`
> `TenantConfig.allowCartGuest` ya existe en el modelo y **no tiene ningún efecto**: nadie lo lee
> (ver ARCHITECTURE §11). Si se agrega `customerAccountsEnabled` sin cablearlo de verdad, el modelo
> se queda con dos flags decorativos en vez de uno. O se cablea, o no se agrega.

## Decisión 2 — Cómo se entregan las credenciales de admin

Hoy el único alta es `POST /auth/register` (`routes/users.js:22`), que crea **tenant + admin de una
sola vez** y, sin SMTP configurado, auto-verifica el email.

**Recomendación:** dejar ese endpoint como está y usarlo como herramienta de onboarding manual del
dueño del producto, no como autoservicio. El alta la hace una persona, una vez por cliente, y
entrega usuario y contraseña por fuera del sistema. `registerLimiter` queda donde está: con un alta
por cliente no molesta a nadie, y protege igual si el endpoint queda expuesto.

Lo que **sí** hay que documentar como procedimiento (no como código): que la contraseña inicial se
cambia en el primer ingreso. Hoy no hay flujo de cambio de contraseña — vale la pena anotarlo como
pendiente antes de sumar clientes.

## Decisión 3 — El seguimiento del invitado

> [!done] Revertida e implementada el 2026-08-19
> Esta decisión decía *"se acepta que no haya historial"* y dejaba el link firmado anotado como
> alternativa descartada. **Se dio vuelta y ya está en el código.** Lo que sigue es lo que se hizo y
> por qué; el párrafo original queda al pie, para que se entienda qué cambió de opinión.

**Cada orden `STORE` nace con un token de seguimiento**: 128 bits de azar (`randomBytes(16)` en
base64url, 22 caracteres, `lib/tokens.js` → `generateOrderTrackingToken`). La base guarda **solo el
SHA-256** en `Order.trackingTokenHash` (UNIQUE), igual que `User.emailVerificationTokenHash`. El
token en claro se emite **una sola vez**, en la respuesta del `POST /store/orders`, como
`tracking: { token }` — hermano de `order` y no un campo suyo: no es un dato del pedido, es la
credencial para volver a verlo.

`GET /store/orders/track/:token` (`routes/store/orders.js`) es la única lectura de orden sin
`verifyStoreToken`. Devuelve `customerOrderView(order)` — el **mismo** objeto que ve un cliente
logueado en `GET /store/orders/:id`, porque que el pedido se vea distinto según por dónde se entró
sería un error, no una medida de seguridad.

### Por qué el token y no el teléfono

La idea de producto era que la identidad del invitado fuera **teléfono + IP**. Las dos partes fallan,
cada una por su lado:

- **Un teléfono es un identificador público**, no un secreto: está en el estado de WhatsApp, en
  Marketplace, en el grupo del barrio. El ataque que importa no es enumerar millones de números, es
  **uno solo dirigido** —la ex pareja, el vecino, la competencia mapeando la clientela—, y con
  "tipeá tu número" eso es **una request**. Ningún rate limit sirve contra un intento.
- **La IP no puede completarlo.** Con CGNAT decenas de abonados móviles comparten la de egreso
  (falso positivo: dos clientes de la misma operadora se ven entre sí) y la misma persona la cambia
  al pasar de datos a WiFi (falso negativo: deja de ver su propio pedido). Una IP que rota no es
  credencial de nada.

También se evaluó **teléfono + últimos dígitos del pedido** —el id es secuencial y enumerable, así
que el "segundo factor" aporta ~12 bits: es teatro— y **código de un solo uso por WhatsApp**, que es
la única que *verifica* la posesión del número pero exige Graph API por tenant y plantillas
aprobadas por Meta, que hoy casi ningún tenant tiene. El OTP queda como camino de upgrade: se suma
encima sin tocar nada de esto, y sería lo que habilitaría listar **varios** pedidos de un mismo
número.

### La IP no se guarda

Se decidió **no agregar ninguna columna de IP a `Order`**. No sirve como factor (arriba), para
control de abuso alcanza el balde con TTL del rate limiter, y una IP en la misma fila que el nombre,
el teléfono y la dirección deja de ser un log para ser **registro comercial**: entra en los backups,
sobrevive años y es candidata permanente a colarse en la planilla de `services/orders-export.js`,
que el tenant se baja y manda por mail.

### Lo que se pierde, dicho en voz alta

- **No existe "tipear mi teléfono y ver mis pedidos".** Sin el link no hay entrada, y la recuperación
  es humana: la persona le escribe al negocio. Es como el negocio ya resuelve esto hoy.
- **El link es un portador**: quien lo reciba reenviado ve ese pedido. Se acota con la caducidad de
  90 días (derivada de `createdAt`, sin columna de vencimiento) y con lo que la respuesta **no**
  trae; no se elimina.
- **No hay historial del lado del servidor.** Un token abre **un** pedido. Que abriera los demás del
  mismo teléfono sería escalada transitiva: un link reenviado a un conocido se volvería acceso a
  todo lo que esa persona compró.

### Detalles que hacen falta para tocarlo

- El `tenantId` va **dentro** del `where`, no verificado después: un token del tenant A no resuelve
  bajo el slug del tenant B.
- **Un solo 404** (`TRACKING_NOT_FOUND`) para inexistente, de otro tenant y vencido: distinguirlos le
  contaría a quien prueba tokens cuál de las tres cosas acertó. La forma del token se valida con Zod
  antes de ir a la base (`orderTrackParams`).
- **No se filtra por `archivedAt`**: lo sella el cierre del turno de caja, o sea el mismo día, y
  filtrar por ahí mataría el link a las pocas horas de entregarlo.
- `orderTrackLimiter` (60 / 15 min por IP, `middleware/rateLimit.js`) es **guarda de recursos, no
  frontera**: contra 128 bits no hay barrido que valga. Por eso es holgado — bajarlo castigaría al
  caso real que sí comparte IP, que es el CGNAT.
- **"Reenviar el link" solo puede implementarse rotando el token**, nunca recuperándolo: en la base
  está el hash. Pendiente, ver abajo.

> [!quote] El párrafo original (2026-07-29)
> *"Recomendación: se acepta que no haya historial. Es el trato de la compra sin cuenta. (…) La
> alternativa —un link firmado por orden— resuelve el seguimiento pero abre una superficie nueva
> (tokens que no expiran, órdenes enumerables) para un problema que el negocio hoy resuelve por
> WhatsApp."*
>
> De los dos reparos, uno se resolvió y el otro no existía: los tokens **sí** expiran (90 días), y
> las órdenes no quedan enumerables porque no se entra por id sino por un token de 128 bits. Lo que
> cambió de fondo es el diagnóstico: "el negocio lo resuelve por WhatsApp" describía el costo como si
> fuera del negocio, cuando lo paga el cliente cada vez que cierra la pestaña.

## Decisión 4 — Los mails de cambio de estado

**Este es el hueco real, y hoy está roto en silencio.**

`sendStatusEmail` (`services/orders.js`) y `notifyAutoAdvance` sacan el destinatario de
`order.user.email`. En una orden de invitado `userId` es `null`, así que **`email` es `undefined` y
la función retorna sin hacer nada**. El cliente no recibe ningún aviso: ni "en preparación", ni
"listo para retirar". No falla, no loguea nada raro — simplemente no manda.

El modelo `Order` no tiene dónde guardar un email: solo `contactPhone` y `contactName`
(`prisma/schema.prisma`).

**Recomendación: (b) como canal principal, (a) como agregado opcional.**

- **(b) Asumir que el canal es WhatsApp.** Es coherente con lo que ya se le pide al invitado
  (teléfono obligatorio, email no) y con cómo el negocio ya se comunica. La pieza existe:
  `lib/whatsapp-link.js` arma el deep-link del pedido. Falta decidir si el aviso de cambio de estado
  sale del panel a mano (el admin aprieta "avisar" y se le abre WhatsApp) o si se automatiza vía el
  bot ([[WhatsApp]]).
- **(a) `Order.contactEmail` opcional**, pedido como campo no obligatorio en el checkout, con
  fallback en `sendStatusEmail` (`order.user?.email ?? order.contactEmail`). Barato y no molesta a
  quien no lo quiera llenar. Sirve sobre todo para el comprobante del pedido.

Lo que **no** conviene es dejarlo como está: hoy la falta de aviso es indistinguible de un fallo de
SMTP, y nadie se va a enterar hasta que un cliente pregunte por su pedido.

## Pendientes que abre este plan

1. Cablear `customerAccountsEnabled` (y de paso decidir qué pasa con `allowCartGuest`).
2. Flujo de cambio de contraseña para el admin: hoy no existe.
3. Elegir entre WhatsApp automático o manual para los avisos de estado.
4. **Reenviar el link de seguimiento desde el panel.** Es el camino de recuperación de la Decisión 3
   —"perdí el link"— y hoy no existe. Como la base guarda el hash, el panel no puede mostrar el link
   viejo: hace falta un `POST /orders/:id/tracking-link` (staff) que **rote** el token y devuelva el
   nuevo. Rotar es lo correcto, además: el link anterior, que puede haber quedado en cualquier lado,
   muere en el acto.
