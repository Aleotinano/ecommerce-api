---
tags: [servicio, dominio/caja]
estado: estable
ultima-revision: 2026-07-30
lado: backend
---

# Caja

> [!success] Implementado (backend, 2026-07-29 / 30)
> Commits `1d283c8` (turno + movimientos etiquetados), `7c515b7` (enganche con los cobros de órdenes),
> `dd3d46b` (exportación a Excel), `5fadd1a` (cruce con estadísticas) y los turnos con horario.
> Módulo: `services/cash-register.js` +
> `services/cash-register-math.js` (puro) + `services/cash-register-export.js` +
> `services/cash-register-schedule.js` (puro),
> `controllers/cash-register.js`, `routes/cash-register.js`, `schemas/cash-register.schema.js`.
> Migraciones `20260729223044_add_cash_register`, `20260730044307_cash_session_schedule` y
> `20260730044550_cash_session_auto_opener`. Operación:
> `node prisma/set-cash-register.js <slug> on|off`. Tests: `tests/cash-register-math.test.js` (sin
> base), `tests/cash-register.test.js`, `tests/cash-register-orders.test.js`,
> `tests/cash-register-schedule.test.js` (sin base), `tests/cash-register-auto.test.js` — 110 en total.
> De la Fase 3 solo queda la exportación por período, ver [[#Fuera de alcance]].

## Propósito

Registrar el **turno de caja física** del local: con cuánto efectivo se abre, qué entró y qué salió
durante el turno, con cuánto se cierra, y **cuánta diferencia hubo** entre lo que el sistema esperaba
y lo que la persona contó a mano.

Pero no es solo el arqueo de las ventas: es **el libro de la plata del negocio**. El pago a los
empleados y el gasto en insumos del local se cargan acá, con etiqueta y destinatario, y por eso
`GET /cash-register/summary` puede contestar *"cuánto pagué de sueldos en julio"* sin que nadie lea
notas a ojo.

La caja **no es un día calendario**: es un turno explícito (apertura → cierre). Eso evita por
completo el problema de zona horaria que tiene [[Estadísticas]] para definir "hoy".

> [!important] Varios turnos por día es lo normal (confirmado con el cliente, 2026-07-30)
> El negocio opera con **mañana, tarde y noche**: se cierra un turno y se abre el siguiente, varias
> veces en el mismo día. El invariante de "un solo turno `OPEN` por tenant" es exactamente eso, no una
> limitación a un turno por día.
>
> La otra mitad de la regla, la que hacía falta para cruzar con [[Estadísticas]]: **un turno es
> indivisible y cuenta en el día en que se ABRIÓ**. El turno noche que cierra a las 2 AM sigue siendo
> "el turno noche del sábado" —así lo nombra el cliente— y sus movimientos de la madrugada entran en
> él, no en el domingo. Nada se parte por fecha.

El software **sigue sin gestionar dinero**: no verifica que la plata exista, igual que las
confirmaciones de cobro de [[Órdenes]]. Lleva la cuenta de lo que un humano declaró y muestra el
desvío. Su valor es exhibir la diferencia, no impedirla.

## Opt-in: `cashRegisterEnabled`

Flag en [[TenantConfig]], default `false`. Con la caja apagada —todos los tenants hoy, mesa-dulce
incluido— **el módulo no existe**: los endpoints devuelven `404 CASH_REGISTER_DISABLED` (404 y no
403: no es que falten permisos) y los cobros de órdenes no exigen turno abierto.

Es **de solo lectura para el tenant** (`READONLY_TENANT_CONFIG_FIELDS`): prendido, cobrar sin turno
abierto falla, así que apagarlo o prenderlo cambia si se puede cobrar — misma clase que las reglas de
plata de [[Perfiles de flujo de venta]]. Y **no** es parte de un perfil, a propósito: si lo fuera,
reaplicar un perfil apagaría la caja de un tenant que la tiene prendida.

```bash
node prisma/set-cash-register.js              # estado de cada tenant
node prisma/set-cash-register.js acme on      # prende + siembra las etiquetas
node prisma/set-cash-register.js acme off     # apaga (no borra nada)
```

> [!warning] Prenderlo cambia la operación diaria
> Con la caja habilitada, olvidarse de abrir el turno **bloquea los cobros**. Hay que avisarle al
> cliente antes de prenderlo, no que lo descubra un sábado a la mañana.

## Turnos con horario: apertura automática y vencimiento

> [!success] Implementado 2026-07-30
> `services/cash-register-schedule.js` (puro) + `TenantConfig.cashSchedule`. Tests:
> `tests/cash-register-schedule.test.js` (sin base) y `tests/cash-register-auto.test.js`.

El tenant carga sus turnos en `cashSchedule` (`PATCH /tenant-config/:id`, lo edita él mismo):

```json
[{ "label": "Mañana", "from": "08:00", "to": "14:00" },
 { "label": "Tarde",  "from": "14:00", "to": "20:00" },
 { "label": "Noche",  "from": "20:00", "to": "02:00" }]
```

`to < from` = cruza la medianoche, y ahí el turno **no se parte**: es uno solo que termina al día
siguiente. Se rechazan los solapados (`CASH_SCHEDULE_OVERLAP` / 400 de Zod): dos turnos que se pisan
hacen ambigua la pregunta "¿en qué turno estamos?", y resolverlo con una regla arbitraria en runtime
sería peor que no aceptarlo. Sin horario cargado, la caja se abre y cierra 100% a mano — la
automatización es opt-in y no cambia la operación de quien no la configuró.

### Se abre solo. **No se cierra solo.**

**Apertura automática**: si llega un cobro o se pide `GET /current` y no hay turno abierto pero el
horario dice que estamos en turno, se abre — con `trigger: AUTO`, el `label` del turno, `expiresAt`
materializado, y **el efectivo contado en el cierre anterior** como apertura (el cajón arrastra; un
cierre sin conteo no sirve de base y ahí abre en 0). Resuelve el problema caro: con la caja prendida,
olvidarse de abrir **bloquea los cobros**.

**El cierre no se automatiza, y es a propósito.** Cerrar una caja es declarar cuánto contó una
persona. Las dos formas de automatizarlo son malas:

- **cerrar con `contado = esperado`** → la diferencia da siempre 0. El módulo entero existe para
  mostrar esa diferencia: automatizarla no la elimina, la **esconde**, y un faltante sistemático se
  vuelve invisible. Es peor que no tener caja, porque da una garantía falsa;
- **cerrar sin conteo y llamarlo arqueo** → un turno "cerrado" que nadie puede auditar.

Lo que sí se hace es tratar la hora de fin como un **vencimiento**:

1. **Vencido** = `status: OPEN` y `expiresAt < now`. **No es un estado en la base**: se deriva, así no
   hace falta ningún job que lo escriba ni queda desincronizado. `GET /current` lo expone como
   `vencido` + `vencidoHaceMinutos` para que el panel lo señale.
2. **Gracia de 60 minutos** (`AUTO_CLOSE_GRACE_MINUTES`, constante): a las 14:05 nadie le arranca el
   turno a quien está contando la plata.
3. Pasada la gracia, **y solo si el turno que corresponde ahora es otro**, el sistema lo cierra
   `closedWithoutCount: true` y abre el nuevo. Sin esa última condición se cerraría un turno solo por
   terminar el horario, aunque no hubiera ninguno que abrir — y ahí lo correcto es dejarlo abierto y
   avisar.

Un turno cerrado sin conteo guarda `expectedCashAmount` (eso el sistema lo sabe) y deja
`countedCashAmount`/`cashDifference` en **`null`**: "nunca se contó" y "se contó y no cuadró" son
cosas distintas, y el CHECK de la migración admite ese caso y solo ese. Se ve así en los tres lados:
el Excel imprime **"SIN CONTEO"** en vez de una diferencia, y [[Estadísticas]] lo excluye de
`diferenciaAcumulada` y lo cuenta en `turnosSinArqueo` — si eso crece, la diferencia acumulada dice
cada vez menos.

> [!note] Por qué *lazy* y no un cron
> El proyecto **no tiene scheduler** (ni `node-cron` ni `setInterval`) y esto no agrega uno: el
> precedente para "una por día" es `ContentSuggestionModel.getToday`, que se resuelve just-in-time. Un
> job perdido en el módulo del dinero es peor que no tener job. La contra es que si nadie toca el
> sistema la apertura no ocurre — pero eso es correcto: si nadie cobró, no hay plata que registrar.
>
> La apertura se dispara **antes** de la transacción del cobro, no adentro: si dos cobros simultáneos
> intentaran abrir el turno, el índice único parcial haría fallar a uno y en Postgres un error dentro
> de la transacción la aborta entera. Afuera, el que pierde la carrera simplemente lee el turno que
> ganó (`P2002` → re-lectura).

## Modelo de datos

Tres modelos, tres enums (`prisma/schema.prisma`).

### `CashRegisterSession` — el turno

`openingAmount` + `openedById`/`openedAt`/`openingNote` (`openedById` es **nullable**: una apertura
automática no tiene persona detrás); `trigger` (`MANUAL`/`AUTO`), `label` y `expiresAt` del turno del
horario —materializados al abrir, como los perfiles de venta: editar el horario no puede mover el
vencimiento de un turno que ya está corriendo—; `closedWithoutCount`; los cuatro campos de cierre
nullables; y los
**snapshots del arqueo calculados al cerrar**: `countedCashAmount`, `expectedCashAmount`,
`cashDifference`, `transferTotal`. Esos cuatro **no se recalculan nunca** (mismo criterio que
`Order.depositAmount` y el precio de `OrderItem`): si mañana se corrige un movimiento viejo, el
arqueo de ayer tiene que seguir diciendo lo que dijo cuando se firmó. Hay un test que lo verifica
metiendo una fila a mano en un turno cerrado.

### `CashMovement` — el movimiento

`type` (ver enum abajo), `channel` (**se reusa `PaymentChannel`**, no un enum propio, para que copiar
una fila del libro de cobros sea directo), `amount` siempre positivo, y:

- `categoryId` — la etiqueta. Obligatoria en los manuales, y en los `ORDER_*` la **reservada** que
  corresponda (`venta` / `devolucion`, ver abajo).
- `payee` — a quién se le pagó, texto libre ("Juan", "Panadería López"). Libre a propósito: el
  repartidor al que se le paga el día no es un `User` del sistema.
- `orderId` — **sin FK**, mismo criterio que `UserAddress`↔`Order` en [[Direcciones]]: el movimiento
  es un hecho histórico de caja y no puede depender de que la orden siga existiendo.
- `orderPaymentId` — **`@unique`**, la pieza que hace imposible anotar el mismo cobro dos veces (ver
  [[#Enganche con los cobros de Órdenes]]). Postgres admite varios `NULL` en un índice único, así que
  los movimientos manuales no se estorban.

> [!note] Del movimiento al comprobante (2026-07-30)
> Los comprobantes de transferencia de [[Órdenes]] (`OrderReceipt`) cuelgan de la fila del libro de
> cobros, así que desde un movimiento de caja se llega al archivo que se miró para dar esa plata por
> cobrada: `CashMovement.orderPaymentId` → `OrderPayment` → `OrderReceipt.orderPaymentId`. **Caja no
> cambió en nada** para que esto funcione — ni una columna.
>
> Sigue sin cambiar después de [[Cloudinary por tenant]] (mismo día): caja no toca `lib/storage/` ni
> Cloudinary por ningún lado. Pero si algún día se expone "ver el comprobante desde el movimiento",
> **ese link no se arma acá**: la URL se emite firmada, con vencimiento, y contra la cuenta de
> Cloudinary donde el archivo está de verdad (`OrderReceipt.cloudName`, que puede ser la de la
> plataforma o la del cliente). El único camino es `toPublicReceipt` de `services/order-receipts.js`,
> que además es **async**. Concatenar una URL a mano da un 404, y persistirla volvería el archivo
> legible para siempre — que es justo lo que ese diseño evita.

### `CashCategory` — el catálogo de etiquetas del tenant

Mismo patrón que `TenantAttribute` ([[Variantes]]): el tenant define su propia taxonomía. `key` (slug
estable, **no editable**), `label` (display, editable), `applies`, `position`, `isActive`,
`@@unique([tenantId, key])`.

**Las etiquetas sí las edita el tenant**: son su taxonomía, no una regla de plata — no cambian cuándo
se produce una orden ni cuánta plata se exige. El CRUD pide `ADMIN`; operar el turno, `ADMIN`/`STAFF`.

Kit de arranque (`DEFAULT_CASH_CATEGORIES`, sembrado al habilitar la caja para que nadie vea una
pantalla vacía): `sueldos`, `insumos`, `proveedores`, `servicios`, `retiro`, `aporte-cambio`,
`ajuste`.

> [!important] Etiquetas reservadas del sistema (2026-07-30)
> `venta` (INCOME) y `devolucion` (EXPENSE), en `SYSTEM_CASH_CATEGORIES` y marcadas con
> `isSystem: true`. Las escribe el enganche con el libro de cobros, no una persona, y existen para que
> **el eje de etiquetas cubra el 100% de la plata**: antes los movimientos de orden entraban sin
> etiqueta, así que `Σ byCategory` no coincidía con el neto y el resumen tenía dos tablas que no
> cerraban entre sí. Ahora sí cierra.
>
> Son **dos** y no una con `applies: BOTH` para que el reporte diga "Venta 850.000 / Devolución −2.000"
> en vez de un neto de 848.000, donde la devolución desaparece.
>
> Qué se puede y qué no: **se pueden renombrar** (el `label` es texto visible y cada rubro le dice
> distinto — "Venta", "Ingreso por pedidos", "Mostrador"), pero **no se borran, no se desactivan y no
> se les cambia `applies`** (`CASH_CATEGORY_RESERVED`, 400): si alguien pudiera, el próximo cobro de
> una orden quedaría archivado como gasto o fallaría. Tampoco se pueden elegir en un movimiento
> manual: "Venta" significa exactamente "cobro de una orden", y si se pudiera cargar a mano la cifra
> de ventas dejaría de tener una orden detrás y el cruce facturado-vs-cobrado de [[Estadísticas]]
> empezaría a mentir.
>
> `ensureSystemCategories` las crea con `upsert` y es self-healing: un tenant que habilitó la caja
> antes de que existieran las recibe la primera vez que cobra, sin que nadie corra nada.

### Enums

```prisma
enum CashSessionStatus { OPEN CLOSED }

// El signo NO se guarda: lo deriva CASH_MOVEMENT_SIGN y `amount` es SIEMPRE positivo.
enum CashMovementType {
  ORDER_DEPOSIT // seña cobrada de una orden        → +
  ORDER_PAYMENT // cobro de una orden               → +
  ORDER_REFUND  // devolución al cliente            → −
  INCOME        // ingreso manual                   → +
  EXPENSE       // egreso manual (sueldo, insumos)  → −
}

// "Sueldos" no es un ingreso jamás.
enum CashCategoryApplies { INCOME EXPENSE BOTH }
```

> [!note] Por qué `CashMovementType` no se reemplazó por `OrderPaymentKind`
> La revisión de la propuesta (07-29) proponía borrarlo y reusar el enum del libro de cobros. No
> cierra: una columna no puede tener dos enums, y la caja necesita además sus dos tipos propios, los
> manuales. Sí se borró `CashMovementMethod`: ahí `PaymentChannel` alcanza.

## Invariantes

1. **Un solo turno `OPEN` por tenant.** Garantizado por el índice único **parcial**
   `CashRegisterSession_tenant_open_key`, no solo por un `findFirst` previo — dos requests
   concurrentes de "abrir caja" dejarían el arqueo sin sentido. El `findFirst` da el error lindo en
   el caso normal (`CASH_SESSION_ALREADY_OPEN`, 409) y el catch del `P2002` cubre la carrera.
2. **`amount` siempre positivo** (`CHECK amount > 0`). El signo lo aporta `CASH_MOVEMENT_SIGN`, en un
   único lugar, y hay un test que verifica que el mapa cubra **todo** el enum leyendo
   `schema.prisma`: agregar un tipo sin decidir su signo es el error que no se puede permitir acá.
   `signedAmount` **lanza** con un tipo desconocido en vez de asumir que suma (más estricto que
   `PAYMENT_SIGN[kind] ?? 1` en [[Órdenes]], a propósito: allá un signo raro desvía un
   `paymentStatus` que se recalcula, acá falsea plata contada).
3. **Solo `channel: CASH` entra al arqueo.** El efectivo esperado es
   `openingAmount + Σ(signo × amount)` sobre los movimientos en efectivo. Las transferencias se
   acumulan aparte (`transferTotal`) porque no están en el cajón y contarlas haría que la diferencia
   mienta siempre.
4. **`GATEWAY` no puede entrar** (`CHECK channel <> 'GATEWAY'`). MercadoPago no pasa por el cajón.
5. **Un turno cerrado es inmutable**: no acepta movimientos ni se reabre. Un error se corrige con un
   movimiento manual en el turno siguiente, con nota — igual que en una caja real. Vale también para
   los cerrados sin conteo: no se "completan" después.
6. **Los movimientos caen siempre en el turno abierto al crearse**: no hay parámetro de sesión en
   ninguna escritura, así que no se puede backdatear a un turno ya arqueado.
7. **Una etiqueta con movimientos no se borra** (`CASH_CATEGORY_IN_USE`, 409): se desactiva. Un
   movimiento de hace tres meses tiene que seguir diciendo qué era. La FK es `Restrict`, así que
   además la base lo impediría.
8. **La etiqueta tiene que aplicar a la dirección del movimiento** (`CASH_CATEGORY_KIND_MISMATCH`,
   400) — un ingreso archivado bajo "Sueldos" ensucia el único reporte que justifica que el catálogo
   exista.
9. **Todo redondeo pasa por `roundMoney`** (`helpers/price.js`). Ver [[#Riesgos]] sobre `Float`.

## Enganche con los cobros de [[Órdenes]]

**Un movimiento de caja por cada fila del libro de cobros que no sea `GATEWAY`.** No hay fórmula que
mantener: el monto y la vía ya vienen resueltos en la fila. Esto era "la parte delicada" de la
propuesta original —con una fórmula de pendiente-por-método que se rompía con `paymentMethod: null` y
cobraba de más cuando la transferencia era solo la seña— y el libro de cobros la borró entera.

| Fila del libro (`OrderPayment.kind`) | Movimiento |
| --- | --- |
| `DEPOSIT` | `ORDER_DEPOSIT` (+) |
| `PAYMENT` | `ORDER_PAYMENT` (+) |
| `REFUND` | `ORDER_REFUND` (−) |

`recordOrderPayments(tx, …)` recibe el `tx` del caller y **no abre transacción propia**: el cobro y
su impacto en el arqueo entran o no entran juntos. Cuelga de los **dos** caminos que escriben en el
libro:

1. `applyPayments` — el embudo de `confirmDeposit`/`confirmTransfer`/`confirmPayment`/
   `registerPayment` (y por ahí entra también el webhook de [[MercadoPago]], que se filtra por
   `GATEWAY`).
2. La liquidación de `updateOrderStatus` — el **"entregar es cobrar"**.

Colgarlo solo del primero era el error obvio: el efectivo del mostrador no tiene ninguna
confirmación previa, así que nunca llegaría al arqueo.

Los dos pasan de `createMany` a **`createManyAndReturn`** porque la caja necesita el `id` de cada
fila. Con eso, `orderPaymentId @unique` + `skipDuplicates` dan **idempotencia estructural**: reanotar
un cobro no lo duplica en el arqueo, ni con dos requests simultáneos.

### Guard de caja abierta

Con `cashRegisterEnabled: true`, confirmar un cobro en efectivo o por transferencia **sin turno
abierto falla** con `CASH_SESSION_NOT_OPEN` (409). Es el punto operativo más importante del módulo:
si el cobro pudiera registrarse fuera de un turno, el arqueo del día quedaría siempre mal y nadie
sabría por qué.

Y como corre dentro de la transacción del caller, **la orden queda sin el cobro sellado** — hay un
test que lo verifica: `paymentStatus` sigue en `PENDING`, `paymentConfirmedAt` en `null` y el libro
vacío. La alternativa (sellar el cobro y fallar la caja) dejaría una orden cobrada con plata que no
está en ningún arqueo.

Dos cosas que **no** disparan el guard, a propósito:

- **Completar una orden ya cobrada**: la liquidación sale vacía, no hay plata nueva que anotar.
- **MercadoPago**: `channel: GATEWAY` se filtra antes de mirar el turno.

El flag se lee con un `findUnique` directo y **no** por el cache de `TenantConfigModel.get` (TTL
600 s): de este flag depende un guard, y una lectura vieja significaría saltearlo.

## Cerrar el turno cierra el día de las órdenes (2026-08-01)

El turno pasó a ser también la definición de **"hoy"** para el tablero de [[Órdenes]]: al cerrar, las
órdenes terminales (entregadas y canceladas) se **archivan** —salen del tablero, no de la base— y
quedan colgadas de este turno. Las que siguen abiertas no se tocan y pasan al turno siguiente.

Por qué acá y no con un corte de medianoche: el turno ya existe precisamente para no tener que
definir "hoy" peleándose con las zonas horarias. Un segundo concepto de día habría sido una segunda
definición de lo mismo, peor. La contracara es que el archivado **es una función de la caja**: un
tenant con `cashRegisterEnabled: false` no archiva nada y su tablero se comporta como siempre.

- `close` y `closeWithoutCount` llaman a `archiveTerminalOrders` (`services/order-archive.js`)
  **dentro de su transacción**, con el `closedAt` del turno como sello. Los dos caminos, porque un
  turno que venció y cerró solo terminó igual: si el automático no archivara, un local que nunca
  cierra la caja a mano no vería limpiarse el tablero jamás.
- `GET /:id` devuelve `orders`: las que ese turno archivó. **Es el historial de órdenes** —"las del
  martes" es "el turno del martes"—, y por eso Órdenes no tiene pantalla de historial propia. Salen
  por `Order.cashSessionId` y no por `CashMovement.orderId`: el movimiento existe solo si hubo un
  cobro por el cajón, así que una cancelada o una de MercadoPago se caerían de la lista.
- Con el turno abierto, `GET /current` y `GET /:id` traen `ordersToClose`
  (`{ toArchive, staysOpen, unpaid }`): lo que se va a llevar el cierre, para mostrarlo **antes** de
  firmar. Las entregadas sin terminar de cobrar se archivan igual — se avisan, no se retienen.
- `POST /close` devuelve `archivedOrders` con el conteo.

Detalle que no es de este módulo pero se apoya en él: `getStatusCounts` de Órdenes llama a
`ensureScheduledSession`, así el turno vencido rueda aunque nadie abra la pantalla de Caja.

## Endpoints — `/cash-register` (backoffice)

Montado en [app.js](app.js). Todos con `verifyToken`; `ADMIN`/`STAFF` para operar y `ADMIN` para
configurar el catálogo. Con el flag apagado, todos responden 404 `CASH_REGISTER_DISABLED`.

| Método | Ruta | Qué hace | Rol |
| --- | --- | --- | --- |
| GET | `/current` | Turno abierto con movimientos, totales **en vivo** y `vencido`/`vencidoHaceMinutos`. Con horario cargado **abre el turno** si corresponde. `session: null` + **200** si no hay ninguno: "no hay caja abierta" es un estado normal que el panel tiene que pintar | ADMIN, STAFF |
| POST | `/open` | `{ openingAmount, note? }`. `openingAmount` puede ser 0 | ADMIN, STAFF |
| POST | `/close` | `{ countedCashAmount, note? }` → devuelve el arqueo | ADMIN, STAFF |
| POST | `/movements` | `{ type: INCOME\|EXPENSE, channel, amount, categoryId, payee?, note? }` | ADMIN, STAFF |
| GET | `/summary` | Totales por etiqueta, tipo y vía en un rango (`from`, `to`), cruzando turnos | ADMIN, STAFF |
| GET | `/categories` | Catálogo (`includeInactive=true` para ver las desactivadas) | ADMIN, STAFF |
| POST | `/categories` | `{ key, label, applies?, position? }` | ADMIN |
| PATCH | `/categories/:id` | `label`/`applies`/`position`/`isActive`. `key` no se edita | ADMIN |
| DELETE | `/categories/:id` | Solo si no tiene movimientos | ADMIN |
| GET | `/` | Historial de turnos (`from`, `to`, `limit` ≤ 100, `offset`) | ADMIN, STAFF |
| GET | `/:id` | Detalle con movimientos. Abierto → totales en vivo; cerrado → el snapshot | ADMIN, STAFF |
| GET | `/:id/export` | El turno en **Excel** (`.xlsx`, 3 hojas) — ver [[#Exportación a Excel]] | ADMIN, STAFF |
| GET | `/export` | El **período** en Excel (`from`, `to`): todos los turnos del rango con su detalle | ADMIN, STAFF |

> Las rutas de nombre fijo se declaran **antes** de `/:id`, o `validateId` rechaza
> `current`/`summary`/`categories` con un 400.
>
> Nombre en inglés (`/cash-register`) para mantener la superficie HTTP como el resto (`/orders`,
> `/promos`, `/stats`), aunque el dominio se llame "caja" con el cliente y en esta doc.

### Códigos de error

| Código | HTTP | Cuándo |
| --- | --- | --- |
| `CASH_REGISTER_DISABLED` | 404 | El tenant no tiene la caja habilitada |
| `CASH_SESSION_ALREADY_OPEN` | 409 | Ya hay un turno abierto |
| `CASH_SESSION_NOT_OPEN` | 409 | No hay turno abierto (al cerrar, al mover plata, o al cobrar una orden) |
| `CASH_SESSION_NOT_FOUND` | 404 | Turno inexistente o de otro tenant |
| `CASH_MOVEMENT_TYPE_NOT_MANUAL` | 400 | Se intentó crear un `ORDER_*` por HTTP |
| `CASH_CATEGORY_NOT_FOUND` | 404 | Etiqueta inexistente o de otro tenant |
| `CASH_CATEGORY_INACTIVE` | 409 | Etiqueta desactivada |
| `CASH_CATEGORY_KIND_MISMATCH` | 400 | La etiqueta no aplica a esa dirección |
| `CASH_CATEGORY_DUPLICATE` | 409 | `key` repetida en el tenant |
| `CASH_CATEGORY_IN_USE` | 409 | Se quiso borrar una etiqueta con movimientos |
| `CASH_CATEGORY_RESERVED` | 400 | Se quiso usar, borrar, desactivar o dar vuelta una etiqueta del sistema, o crear una con su clave |
| `CASH_SCHEDULE_OVERLAP` | 400 | Dos turnos del horario se solapan |
| `CASH_MOVEMENT_TYPE_UNKNOWN` | 500 | Tipo sin signo en `CASH_MOVEMENT_SIGN` (bug, no operación) |

## Exportación a Excel

`GET /cash-register/:id/export` → `.xlsx` con tres hojas
(`services/cash-register-export.js`, `exceljs@4.4.0`):

| Hoja | Qué tiene |
| --- | --- |
| **Turno** | Encabezado con el nombre de la tienda, quién abrió/cerró (por **nombre**, no por id), montos, y el arqueo con la diferencia en rojo o verde. Un turno abierto muestra el esperado en vivo y ningún arqueo |
| **Movimientos** | Una fila por movimiento con fecha, tipo y vía en castellano, etiqueta, destinatario, monto **con signo**, orden, nota y quién lo cargó. Con autofiltro y fila de encabezado congelada |
| **Resumen** | Totales por etiqueta (ordenados de mayor egreso a menor) y por tipo, más el recordatorio de que las transferencias no entran al arqueo |

Reemplaza al "resumen imprimible" que estaba planeado en la Fase 3: un `.xlsx` se imprime igual y
además se puede sumar aparte, que es lo que hace un contador. El módulo **no toca la base** —recibe el
turno ya cargado— y toda la aritmética viene de `cash-register-math.js`, así que la planilla no puede
decir un número distinto al de la API (hay un test que lee el archivo generado y compara).

> [!warning] Las fechas de Excel son hora de pared, sin zona
> Postgres guarda UTC y una celda de fecha de Excel no tiene timezone: escribir el `Date` crudo hacía
> que un turno abierto a las 19:44 se imprimiera **"22:44"**, que en un arqueo del día es un dato
> equivocado. `toWallClock` lo corrige al huso del **servidor**, que es donde opera el negocio. No hay
> timezone por tenant en el modelo todavía —el mismo agujero que tiene [[Estadísticas]] para definir
> "hoy"—; cuando exista, entra por esa función. Hay un test que falla si el shift se pierde.

### El período entero

`GET /cash-register/export?from=&to=` — la misma idea para un rango: una hoja con **un renglón por
turno** (apertura, cierre, quién, esperado, contado, diferencia), una con **todos los movimientos** del
período, y una de totales. Es "mandame el Excel de julio", que antes exigía bajar turno por turno. Un
turno cerrado sin conteo sale con `SIN CONTEO` en rojo en la columna de contado, no con un 0.

> [!warning] Un `YYYY-MM-DD` es un día, no un instante
> `z.coerce.date()` parsea `"2026-07-01"` como medianoche **UTC**: con el server en UTC−3 el archivo de
> julio arrancaba el 30 de junio a las 21:00 y —peor— `to=2026-07-31` dejaba afuera casi todo el 31.
> `dayBoundary` (schemas/cash-register.schema.js) ancla el `from` al **arranque del día local** y el
> `to` al **final**; una fecha con hora explícita se respeta tal cual. Lo mismo con el nombre del
> archivo: `isoDay` usa el día local, porque con `toISOString()` un turno abierto a las 22:00 se
> llamaba con la fecha de mañana. Hay tests de las dos cosas.

El nombre del archivo (`caja-turno-7-2026-07-29.xlsx`, `caja-2026-07-01_2026-07-31.xlsx`) viaja en
`Content-Disposition`, expuesto con `Access-Control-Expose-Headers` para que un `fetch` + blob del
panel pueda leerlo.

## Cómo se ve un turno

Walkthrough real contra dev (tenant `acme`), el mismo que se corrió al implementarlo:

```
abrir con 5000
  → EXPENSE  CASH 2000  etiqueta: sueldos   payee: Juan
  → EXPENSE  CASH  500  etiqueta: insumos
  → ORDER_PAYMENT CASH 14990  (orden #46 completada en efectivo, automático)
GET /current  → esperado 17490
cerrar contando 17400  → diferencia −90
GET /summary  → byType { ORDER_PAYMENT: 14990, EXPENSE: −2500 }
                byCategory { sueldos: −2000 (1), insumos: −500 (1) }
```

## Dependencias

- **`exceljs`** (4.4.0) — única dependencia externa del módulo, y solo la usa
  `cash-register-export.js`. Se eligió sobre `xlsx`/SheetJS porque la versión de SheetJS publicada en
  npm está congelada y con CVEs (la mantenida se distribuye fuera del registry).
- [[Órdenes]] — origen de los movimientos automáticos, vía el libro de cobros. La caja le agrega el
  guard de turno abierto y el `createManyAndReturn`; el motor de estados no se tocó.
- [[TenantConfig]] — flag `cashRegisterEnabled` (bloque de "lo configuramos nosotros").
- [[Perfiles de flujo de venta]] — misma clase de campo, pero la caja **no** entra en los perfiles.
- [[Roles]] — `ADMIN`/`STAFF` para operar, `ADMIN` para el catálogo.
- [[Multi-tenancy]] — scoping por `tenantId` a mano en cada query, como el resto de los servicios.
- [[Estadísticas]] — sin dependencia hoy; posible cruce en la Fase 3.
- [[MercadoPago]] — se ignora explícitamente (`GATEWAY`).

## Deuda técnica / cosas raras

Etiquetas por tipo de acción — ver convención en [[App]].

- `[riesgo]` **`Float` para dinero.** Todo el repo lo usa (`Order.total`, `OrderItem.price`,
  `depositAmount`) y este módulo lo respeta por consistencia, pero la caja es el primer lugar donde
  el error de redondeo se vuelve **visible para el cliente**: una diferencia de $0,01 en un arqueo
  genera una llamada. Mitigado con `roundMoney` en todo cálculo y comparación (hay un test de
  `0.1 + 0.2`); la mitigación real es migrar el dinero a `Decimal`, que es transversal y merece su
  propia decisión.
- `[nota]` **El arqueo no cuenta billetes por denominación.** Se declara un total. Si el cliente
  pide planilla de conteo, es un campo `Json` más, no un rediseño.
- `[nota]` **Cancelar una orden ya cobrada no genera un `ORDER_REFUND` automático.** El enum lo
  contempla, pero engancharlo a `updateOrderStatus → CANCELLED` significaría que **cancelar puede
  fallar por no haber caja abierta**. Se carga como movimiento manual y se revisa con uso real.
- `[nota]` **`getSummary` no pagina.** Es `groupBy`, así que devuelve tantas filas como etiquetas
  tenga el tenant — acotado por diseño. El historial de turnos sí pagina (`limit` ≤ 100).
- `[riesgo]` **Nada impide un egreso mayor al efectivo del turno**, y el `expectedCashAmount` puede
  quedar **negativo** (apareció armando los fixtures de `tests/stats-cash.test.js`). En un cajón real
  es imposible, pero **bloquearlo sería peor**: el caso legítimo es que el dueño pague un insumo de su
  bolsillo y se olvide de registrar el `INCOME`. Se **avisa**, no se impide: `buildArqueo` devuelve
  `expectedNegative` (`isExpectedNegative`; cero no cuenta, una caja vacía cuadra) y viaja en el
  `totals` de `GET /current`, del cierre y del detalle — en un turno cerrado se deriva del snapshot,
  así que **no es una columna**. El panel lo pinta como advertencia en la pantalla de caja, en la
  ficha del turno, en el formulario de cierre y en el historial, y **el cierre sigue habilitado**. El
  escenario sigue siendo posible; lo que cambió es que ahora se ve.
- `[código-muerto]` `MANUAL_MOVEMENT_TYPES` se valida **dos veces** (Zod en la ruta y el service).
  Es a propósito: el service se llama desde tests y scripts, y un `ORDER_PAYMENT` inventado sería
  plata que la caja dice haber cobrado y ninguna orden respalda.

## Preguntas abiertas / mejoras candidatas

> [!info] El modelo corregido está aparte
> Este servicio no tiene una entidad que agrupe la jornada: en un mismo día calendario hay varios
> turnos (el 3 de agosto hubo cuatro) y el turno se rotula "Caja del día", que miente. El modelo con
> la entidad **Día** y una hora de corte configurable está en
> [[Caja — día operativo (propuesta)]], junto con el vocabulario normativo y las decisiones
> abiertas. Varias de las preguntas de abajo ya están contestadas ahí.

- **Cierre "a ciegas".** Algunos negocios prefieren que quien cierra no vea el esperado antes de
  contar (evita que "ajuste" el conteo). Hoy `/current` lo muestra. Si el cliente lo pide, es un flag
  más, no un rediseño.
- **¿El arqueo debería poder firmarse con una diferencia grande sin fricción?** Hoy cerrar con
  −50 000 es tan fácil como cerrar en cero. Un umbral que exija nota sería barato y probablemente
  útil.
- **¿`payee` merece convertirse en catálogo?** Si aparecen 8 empleados fijos, el texto libre empieza
  a tener typos y el reporte por persona se degrada. La salida natural es el mismo patrón de
  `CashCategory`, pero no vale la pena antes de ver uso real.

## Fuera de alcance

De la **Fase 3 (reportes)** ya salieron tres cosas: la exportación a Excel del turno (arriba), las
diferencias de arqueo acumuladas y el **cruce con [[Estadísticas]]** — el dashboard ahora muestra
facturado vs cobrado, por qué vía entró la plata, y los egresos del local con un resultado
aproximado. Ver [[Estadísticas]] → "Cobranzas y caja".

La **Fase 3 quedó cerrada** con la exportación por período (arriba). Queda pendiente, y ya no es de
este módulo: el **costo de mercadería** — sin él,
`resultadoAproximado` responde "¿me quedó plata?" pero no "¿gano dinero?".
>
> Ojo con el malentendido, que ya apareció una vez: **la plata de la mercadería SÍ está en la caja** si
> se carga como egreso (para eso están "Insumos" y "Proveedores"). Lo que falta no es el gasto, es la
> **atribución**: el egreso pesa el día que se compró (no el día que se vendió) y no está pegado a
> ningún producto, así que de la caja no puede salir margen por producto ni por combo. Eso pide un
> costo por variante y, sobre todo, que alguien lo mantenga cuando sube la harina — un margen que
> nadie actualiza es peor que no tener margen.

Tampoco: un módulo de **liquidación de sueldos** (empleados, períodos, recibos). La caja registra el
egreso con su etiqueta y su destinatario, que es lo que se pidió; una nómina es otro dominio y merece
su propia decisión.
