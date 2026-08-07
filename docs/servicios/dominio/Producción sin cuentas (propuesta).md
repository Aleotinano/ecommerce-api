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

## Decisión 3 — El historial del invitado

**Recomendación: se acepta que no haya historial.** Es el trato de la compra sin cuenta.

`GET /store/orders` y `GET /store/orders/:id` exigen `verifyStoreToken` (`routes/store/orders.js`),
y está bien: un invitado no tiene con qué probar que una orden es suya. Lo que ve al confirmar sale
de la respuesta del `POST`, que ya incluye el detalle completo y el deep-link de WhatsApp.

La alternativa —un link firmado por orden, tipo `/store/orders/:id?token=...`— resuelve el
seguimiento pero abre una superficie nueva (tokens que no expiran, órdenes enumerables) para un
problema que el negocio hoy resuelve por WhatsApp. Se deja anotada, no se implementa.

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
