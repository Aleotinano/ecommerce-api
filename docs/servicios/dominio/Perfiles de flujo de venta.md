---
tags: [servicio, dominio/tenant-config, dominio/ordenes]
estado: estable
ultima-revision: 2026-07-29
lado: backend
---

# Perfiles de flujo de venta

> [!note] Implementado (backend, 2026-07-29)
> `services/tenant-profiles.js` (módulo puro), columnas `paymentMethodsEnabled` /
> `fulfillmentMethodsEnabled` en `TenantConfig` (migración `20260729212531_add_tenant_order_flow`),
> guard `assertMethodEnabled` en `services/orders.js`, script de operación
> `prisma/set-tenant-profile.js`. Tests: `tests/tenant-profiles.test.js` (sin base) y
> `tests/orders-payment-methods.test.js`.

## Para qué existe

Distintos rubros venden distinto. Una rotisería cobra contra entrega y listo; una pastelería acepta
transferencia por adelantado y efectivo al retirar; un taller que produce a pedido necesita una seña
antes de ponerse a trabajar. El motor de estados ([[Órdenes]] → "Máquina de estados") **ya sabía
manejar los tres**: la regla de dinero en `moneyBlocker` es una sola y sale de los parámetros del
tenant.

Lo que no existía era la capa de arriba: **qué métodos acepta cada tenant**. Los enums de
`schemas/order.schema.js` valían para todos, así que un negocio que solo cobra contra entrega igual
recibía una orden por transferencia desde el storefront y nada la rechazaba. Y al registrar un
tenant, su `TenantConfig` nacía con solo `tenantId` + `storeName`: todo lo demás caía en los
`@default()` del schema Prisma, que son un único set global. No había forma de tener varios "kits de
arranque".

Un perfil es ese kit: un nombre que resuelve de una los cuatro campos que definen el flujo de venta.

## Los tres perfiles

| perfil | pagos | entregas | seña | para quién |
|---|---|---|---|---|
| `estandar` *(default)* | `CASH`, `TRANSFER`, `MIXED` | `DELIVERY`, `PICKUP` | no | el caso general: acepta todo y no exige nada por adelantado |
| `contraentrega` | `CASH` | `DELIVERY` | no | el repartidor cobra al entregar; no hay retiro en local ni transferencia |
| `produccion-por-sena` | `CASH`, `TRANSFER`, `MIXED` | `DELIVERY`, `PICKUP` | sí, 50% | producción a pedido: hay que cobrar la seña antes de producir |

Cómo se traduce cada uno en el motor, sin que haya que configurarlo aparte:

- **`contraentrega`** → `moneyBlocker` no pide plata para `CASH`, así que la orden puede producirse
  apenas la revisa un humano. El cobro se registra solo cuando pasa a `COMPLETED` (ver
  [[Órdenes]] → "Entregar es cobrar").
- **`estandar`** → si el pedido es por transferencia (total o la parte transferida de un `MIXED`),
  esa parte tiene que estar cobrada antes de producir (`TRANSFER_NOT_CONFIRMED`). El efectivo no
  traba nada.
- **`produccion-por-sena`** → alcanza con la seña cobrada para producir; el saldo se cobra al
  entregar (`DEPOSIT_NOT_CONFIRMED` mientras no entre).

> [!tip] `estandar` es el perfil de [[mesa dulce demo|Mesa Dulce]]
> El primer cliente en producción usa los tres métodos de pago, las dos formas de entrega y no cobra
> seña — exactamente `estandar`, que es además lo que ya hacían los `@default()`. **No hizo falta un
> perfil a medida para el primer cliente**, y conviene no inventarlo: un perfil por cliente es una
> tabla de configuración disfrazada de código.

## Lo que NO es

- **No es una indirección viva.** Los valores se **materializan** en las columnas del tenant al
  crearlo. Editar un perfil no cambia a los tenants ya creados. Es deliberado: lo que está en juego
  es cuándo se produce un pedido y cuánta plata se exige antes, así que un cambio retroactivo
  significaría que una orden tomada la semana pasada deja de poder producirse porque alguien tocó un
  archivo. La fuente de verdad son siempre las columnas.
- **No es configuración del tenant.** Los cuatro campos son de solo lectura para el dueño de la
  tienda (ver [[TenantConfig]] → "Dos clases de campo"). Los configuramos nosotros, cliente por
  cliente.
- **No es un catálogo cerrado.** Agregar un perfil es esperado y no rompe nada (ver "Cómo agregar un
  perfil"). Lo que no debería crecer es la *cantidad de ejes*: si un cliente nuevo necesita un campo
  que no existe, eso sí es un cambio de contrato.
- **No incluye el módulo de [[Caja]].** `cashRegisterEnabled` es de la misma clase (lo configuramos
  nosotros, y prendido cambia si se puede cobrar), pero **no** entra en el perfil a propósito: si
  entrara, reaplicar un perfil apagaría la caja de un tenant que la tiene prendida. Va por
  `prisma/set-cash-register.js`.

## Los cuatro campos

Viven en `TenantConfig` y son el contrato completo de un perfil:

```prisma
paymentMethodsEnabled     OrderPaymentMethod[] @default([CASH, TRANSFER, MIXED])
fulfillmentMethodsEnabled FulfillmentMethod[]  @default([DELIVERY, PICKUP])
depositEnabled            Boolean              @default(false)
depositPercentage         Int                  @default(50)
```

Arrays de **enum** y no `String[]`: la validación la hace Postgres, no la buena memoria del caller.

Los `@default()` son lo que hizo segura la migración — reproducen el comportamiento anterior a que
las columnas existieran, así que ningún tenant cambió de conducta al aplicarla, y un tenant recién
creado no queda inservible antes de que lo configuremos.

## Cómo se aplica

Tres vías, **ninguna expuesta por HTTP**:

1. **Al registrar** — `UserModel.register` acepta un `profile` (default `estandar`) y lo espardece en
   el `tenantConfig.create` que ya hacía. **No está en `registerSchema`** a propósito: es un
   parámetro de service, no un campo que pueda mandar un cliente — quién vende con seña no lo decide
   quien se registra.
2. **A mano, después** — el script de operación:
   ```bash
   node prisma/set-tenant-profile.js mesa-dulce estandar
   ```
   Sin argumentos lista los perfiles y el flujo actual de cada tenant, que es la forma rápida de
   auditar cómo está configurado el sistema. Es idempotente y solo toca los cuatro campos: branding,
   tema, SEO y contacto quedan intactos.
3. **En los seeds** — `prisma/seed-tenant-config.js` tiene un `tenantProfileSeeds` por slug, separado
   de `tenantConfigSeeds` (que es branding). La config de un tenant sembrado es "perfil + branding".

> [!warning] No hay endpoint, y es a propósito
> Cualquier ruta protegida con `requireRole(["ADMIN"])` se la puede pegar el admin **del propio
> tenant** — es el mismo rol. Un endpoint para aplicar perfiles reabriría justo el agujero que estos
> campos cierran. Si algún día hace falta autoservicio, primero hace falta un rol de plataforma que
> hoy no existe.

## Reglas

- **`resolveProfile(name)` lanza con un nombre desconocido** (`TENANT_PROFILE_UNKNOWN`, 400) en vez
  de caer al default. Un typo en el script de operación tiene que fallar fuerte: caer al default
  silenciosamente dejaría al tenant con el flujo de otro negocio y nadie se enteraría hasta que un
  pedido no se pueda cobrar.
- **Devuelve una copia** (incluidos los arrays). Un caller que mute lo que recibe no puede editar el
  perfil para todo el proceso.
- **En `register` el perfil se resuelve ANTES de la transacción**, así un nombre inválido no deja un
  tenant creado a medias.
- **Una lista vacía se lee como "todo habilitado", no como "nada".** Es el comportamiento anterior a
  las columnas, y evita que una config a medio migrar deje al tenant sin poder vender. Está cubierto
  por test.
- **El guard corre en dos lugares** (`assertMethodEnabled`, `services/orders.js`):
  - `OrderModel.create`, **antes** de abrir la transacción — un método no habilitado corta el
    checkout sin tocar stock ni vaciar el [[Carrito]], así el cliente corrige el método y reintenta
    sin rearmar el pedido.
  - `reviewOrder`, sobre el estado **resultante** — es la otra puerta por la que se elige método,
    típica en las órdenes del bot de [[WhatsApp]], que nacen sin ninguno.
- **`requiresDeposit`/`depositAmount` son un snapshot por orden.** Activar la seña en el tenant solo
  afecta pedidos nuevos; cambiar el porcentaje no recalcula los ya tomados.
- **`estandar` tiene que coincidir con los `@default()` del schema**, y hay un test que lo verifica
  leyendo `prisma/schema.prisma`. Si se desincronizan, un tenant creado por `register` (que aplica el
  perfil) y otro creado por SQL a mano (que cae en los defaults de la columna) se comportarían
  distinto — y encontrar eso después es carísimo.

## Errores

| Código | HTTP | Cuándo |
|---|---|---|
| `PAYMENT_METHOD_NOT_ENABLED` | 400 | el método de pago pedido no está en `paymentMethodsEnabled`. `details: { pedido, habilitados }` |
| `FULFILLMENT_METHOD_NOT_ENABLED` | 400 | ídem con `fulfillmentMethodsEnabled` |
| `TENANT_PROFILE_UNKNOWN` | 400 | nombre de perfil inexistente. `details: { perfil, validos }` |

Los dos primeros traen `habilitados` para que el panel y el storefront puedan decir **qué sí se
puede**, no solo que esto no.

## Cómo agregar un perfil

1. Sumar la clave a `TENANT_PROFILES` en `services/tenant-profiles.js`, con los cuatro campos.
2. Nada más. No hay migración, no hay Zod, no hay endpoint: el script y `register` lo toman solo, y
   `tests/tenant-profiles.test.js` ya valida la forma de todos los perfiles en bloque.

Si el perfil nuevo necesitara un campo que no existe, ahí sí hay que tocar Prisma + migración +
`READONLY_TENANT_CONFIG_FIELDS`, y actualizar esta nota.

## Dependencias

- **Depende de**: [[TenantConfig]] (las cuatro columnas y la separación editable/nuestro),
  [[Usuarios y Auth]] (`register` aplica el perfil).
- **Lo consume**: [[Órdenes]] (`create` y `reviewOrder` validan contra los métodos habilitados y
  resuelven la seña).
- **Lo lee el storefront**: `GET /store/config` devuelve los cuatro campos, para pintar el checkout
  solo con los métodos que el tenant acepta.
- **Relacionado**: [[Producción sin cuentas (propuesta)]] — misma decisión de fondo (la
  configuración del cliente la manejamos nosotros, no hay autoservicio) aplicada a las cuentas. Y
  [[Caja]], que usa el mismo mecanismo de solo-lectura + script pero **fuera** del perfil (ver "Lo
  que NO es").

## Deuda técnica / cosas raras

- `[nota]` **Un perfil no queda registrado en el tenant.** No hay columna `orderFlowProfile`: una vez
  aplicado, solo quedan los valores. El panel no puede decir "estás en el perfil Pastelería", y
  reconstruirlo desde los valores es adivinar (dos perfiles podrían coincidir). Se descartó a
  propósito para que la fuente de verdad sea una sola, pero si el panel llega a necesitar mostrar el
  nombre, la salida es guardarlo como **etiqueta descriptiva** —nunca como algo que se resuelva en
  tiempo de lectura.
- `[nota]` **El script no valida contra órdenes en curso.** Apagar un método de pago no rompe las
  órdenes ya creadas (el motor mira el `paymentMethod` que la orden ya tiene, no la lista del
  tenant), pero sí puede dejar el panel ofreciendo un método que el checkout rechaza si alguien
  edita una orden vieja. En la práctica no pasó; vale saberlo antes de cambiarle el perfil a un
  tenant con pedidos abiertos.
- `[riesgo]` **`TenantConfig.allowCartGuest` sigue sin efecto** y ahora conviven con campos de flujo
  que sí se leen. Un flag decorativo al lado de cuatro que no lo son invita a asumir que este
  también se respeta. No es de este módulo, pero se agrava con él — ver ARCHITECTURE §11.

## Preguntas abiertas / mejoras candidatas

- ¿Los perfiles deberían poder expresar **qué se exige antes de producir** de forma explícita, en vez
  de que salga implícito de los métodos + seña? Hoy la regla vive en `moneyBlocker` y los perfiles
  solo la parametrizan. Alcanza para los tres flujos conocidos; un cuarto rubro con una regla
  distinta (por ejemplo "transferencia obligatoria pero producir igual") no se podría expresar sin
  tocar el motor.
- ¿Vale un perfil para **MercadoPago**? Hoy `GATEWAY` no es un `OrderPaymentMethod` —vive solo como
  `PaymentChannel` del libro de cobros— así que un tenant que cobra online no se distingue por acá.
  Ver [[MercadoPago]].
- ¿El script debería poder aplicar un perfil a **varios tenants** de una? Con tres tenants no hace
  falta; con treinta, sí.
