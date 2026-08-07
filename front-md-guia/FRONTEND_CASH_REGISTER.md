---
lado: contrato
---

# Guía frontend: Caja (turno, movimientos, arqueo)

Feature: **caja registradora** — el turno de caja física del local. Con cuánto efectivo se abre, qué
entró y qué salió, con cuánto se cierra, y **cuánta diferencia** hubo entre lo esperado y lo contado.

Además del cobro de las órdenes (que **cae solo**, ver §6), es el libro de la plata del negocio: los
sueldos, los insumos, los retiros y los aportes de cambio se cargan a mano con una **etiqueta** y un
destinatario opcional. Eso es lo que hace que se pueda contestar *"cuánto pagué de sueldos en julio"*.

> Es **exclusivo del Panel Admin** (rutas `/cash-register`, sin prefijo, cookie — ver
> [FRONTEND_INTEGRATION.md](FRONTEND_INTEGRATION.md)). El storefront no lo toca ni lo ve.
>
> La caja **no es un día calendario**: es un turno explícito. No hay "caja del 29/07", hay "el turno
> que abrió Fulano a las 9:05 y cerró a las 21:30".

---

## 0. Antes que nada: el módulo es opt-in

`TenantConfig.cashRegisterEnabled` (booleano, viene en `GET /tenant-config/:tenantId` y en
`GET /store/config`). **Si es `false`, todos los endpoints devuelven `404 CASH_REGISTER_DISABLED`** —
no mostrar la sección del panel.

No es editable desde el panel (está en los campos de solo lectura, como `depositEnabled`): lo
habilitamos nosotros por tenant. Si el cliente lo pide, es un pedido a nosotros, no un toggle.

---

## 1. Modelo

| Entidad | Campo | Tipo | Notas |
|---|---|---|---|
| `session` | `id`, `status` | `"OPEN" \| "CLOSED"` | Hay **a lo sumo un turno OPEN** por tenant (varios por día es normal: mañana/tarde/noche) |
| | `trigger` | `"MANUAL" \| "AUTO"` | `AUTO` = lo abrió el horario del tenant, no una persona |
| | `label`, `expiresAt` | string \| null | nombre y fin del turno del horario. Null en turnos manuales sin horario |
| | `vencido`, `vencidoHaceMinutos` | boolean, number | **solo en `/current`**: pasó su hora y sigue abierto. Derivados, no columnas |
| | `closedWithoutCount` | boolean | el backend lo cerró por vencido sin que nadie contara: `countedCashAmount` y `cashDifference` vienen en `null` |
| | `openingAmount` | number ≥ 0 | efectivo declarado al abrir (0 es válido) |
| | `openedById`, `openedAt`, `openingNote` | — | quién y cuándo abrió |
| | `closedById`, `closedAt`, `closingNote` | `null` mientras está abierto | |
| | `countedCashAmount` | number \| null | lo que la persona contó a mano |
| | `expectedCashAmount` | number \| null | `openingAmount + Σ movimientos en efectivo` |
| | `cashDifference` | number \| null | `contado − esperado`. **Negativo = falta plata** |
| | `transferTotal` | number \| null | total transferido. **Informativo, NO entra al arqueo** |
| `movement` | `type` | enum | `INCOME` \| `EXPENSE` (manuales) · `ORDER_DEPOSIT` \| `ORDER_PAYMENT` \| `ORDER_REFUND` (automáticos) |
| | `channel` | `"CASH" \| "TRANSFER"` | `GATEWAY` (MercadoPago) **no existe** acá |
| | `amount` | number > 0 | **siempre positivo**; el signo lo da el `type` (ver abajo) |
| | `categoryId` + `category` | int \| null | la etiqueta. Obligatoria en los manuales, `null` en los `ORDER_*` |
| | `payee` | string \| null | a quién se le pagó ("Juan", "Panadería López") |
| | `orderId` | int \| null | presente solo en los `ORDER_*`; linkealo a la orden |
| | `note`, `createdById`, `createdAt` | — | |
| `category` | `id`, `key`, `label` | — | `key` es el slug estable y **no se puede editar**; `label` sí |
| | `isSystem` | boolean | etiqueta **reservada** (`venta`, `devolucion`): la usan los cobros de órdenes. **No la ofrezcas en el picker**, no se borra ni se desactiva — solo se renombra |
| | `applies` | `"INCOME" \| "EXPENSE" \| "BOTH"` | a qué dirección aplica ("Sueldos" nunca es un ingreso) |
| | `position`, `isActive` | — | orden de display; las inactivas no se ofrecen |

### El signo no viene en el número

`amount` es siempre positivo. Para mostrar el movimiento con signo:

```js
const SIGN = {
  ORDER_DEPOSIT: +1, ORDER_PAYMENT: +1, ORDER_REFUND: -1,
  INCOME: +1, EXPENSE: -1,
};
const signed = SIGN[movement.type] * movement.amount;
```

Los totales que devuelve el backend (`totals`, `summary`, `byCategory`, `byType`) **ya vienen con
signo aplicado**: un `byCategory.sueldos.total` de `-25000` significa que se pagaron 25.000.

### Solo el efectivo entra al arqueo

`expectedCashAmount` suma **únicamente** los movimientos con `channel: "CASH"`. Las transferencias van
a `transferTotal` porque no están en el cajón: contarlas haría que la diferencia mienta siempre. En la
UI conviene mostrarlas como dos columnas separadas, no como un total único.

---

## 2. Endpoints (`/cash-register`, cookie)

`ADMIN` y `STAFF` operan el turno. El **catálogo de etiquetas es solo `ADMIN`** (es configuración, no
operación).

| Método | Ruta | Body / query | Devuelve |
|---|---|---|---|
| GET | `/cash-register/current` | — | `{ session }` — el turno abierto con `movements`, `totals` en vivo y `vencido`. **Puede abrir el turno** si hay horario vigente (§5.2). **`{ session: null }` con 200** si no hay ninguno |
| POST | `/cash-register/open` | `{ openingAmount, note? }` | `201 { message, session }` |
| POST | `/cash-register/close` | `{ countedCashAmount, note? }` | `{ message, session }` con el arqueo |
| POST | `/cash-register/movements` | `{ type, channel, amount, categoryId, payee?, note? }` | `201 { message, movement }` |
| GET | `/cash-register/summary` | `?from=&to=` (ISO) | `{ from, to, byType, byChannel, byCategory }` |
| GET | `/cash-register` | `?from=&to=&limit=&offset=` (`limit` ≤ 100, default 20) | `{ sessions, total, limit, offset }` |
| GET | `/cash-register/:id` | — | `{ session }` con `movements`, `summary` y `totals` |
| GET | `/cash-register/:id/export` | — | **binario `.xlsx`** (no JSON) — ver §5.1 |
| GET | `/cash-register/export` | `?from=&to=` | **binario `.xlsx`** del período: todos los turnos del rango con su detalle |
| GET | `/cash-register/categories` | `?includeInactive=true` | `{ categories }` |
| POST | `/cash-register/categories` | `{ key, label, applies?, position? }` | `201 { message, category }` — **ADMIN** |
| PATCH | `/cash-register/categories/:id` | `{ label?, applies?, position?, isActive? }` | `{ message, category }` — **ADMIN** |
| DELETE | `/cash-register/categories/:id` | — | `{ message }` — **ADMIN** |

> **`{ session: null }` con 200 no es un error.** "No hay caja abierta" es un estado normal de la
> operación: la pantalla tiene que mostrar el botón "Abrir caja", no un cartel de error.

---

## 3. Los tres estados de la pantalla

1. **Módulo apagado** (`cashRegisterEnabled: false`) → la sección no existe.
2. **Sin turno abierto** (`session: null`) → formulario de apertura (`openingAmount` + nota) y, si
   querés, el link al historial.
3. **Turno abierto** → el tablero: esperado en efectivo, total transferido, lista de movimientos,
   botón de movimiento manual y botón de cierre.

En el estado 3, `totals.cashDifference` es `null` (todavía no se contó nada) — no lo pintes como 0.

---

## 4. Cargar un egreso (el caso "sueldos" e "insumos")

```http
POST /cash-register/movements
{ "type": "EXPENSE", "channel": "CASH", "amount": 20000,
  "categoryId": 1, "payee": "Juan Pérez", "note": "quincena de julio" }
```

Reglas para el form:

- **`categoryId` es obligatorio.** Un egreso sin etiquetar no se puede reportar, que es el único
  motivo por el que existe el catálogo. Cargá el picker desde `GET /categories` **filtrando las
  `isSystem`**: "Venta" y "Devolución" son de los cobros de órdenes, y mandarlas da
  `400 CASH_CATEGORY_RESERVED`.
- **Filtrá el picker por dirección.** Con `type: "EXPENSE"` mostrá solo las etiquetas con
  `applies` en `["EXPENSE", "BOTH"]`; con `INCOME`, `["INCOME", "BOTH"]`. Si no, el backend responde
  `400 CASH_CATEGORY_KIND_MISMATCH`.
- **`amount` siempre positivo**, sin signo, sin separadores de miles al enviar.
- **`type` solo acepta `INCOME`/`EXPENSE`.** Los `ORDER_*` los escribe el sistema; mandarlos da `400`.
- `payee` y `note` son opcionales pero valen la pena: son lo que hace legible el arqueo tres semanas
  después.

---

## 5. Cerrar el turno

```http
POST /cash-register/close
{ "countedCashAmount": 17400, "note": "faltan 90" }
```

La respuesta trae `expectedCashAmount`, `countedCashAmount` y `cashDifference`. Mostralos juntos, y la
diferencia con color (negativo = falta). **Pedí confirmación antes de enviar**: un turno cerrado es
inmutable, no se reabre, y su arqueo es un snapshot que no se recalcula nunca — si hubo un error se
corrige con un movimiento manual en el turno siguiente, con nota, como en una caja real.

### 5.1 Descargar el turno en Excel

`GET /cash-register/:id/export` devuelve un **`.xlsx` binario**, no JSON. Sirve para el turno abierto
también (sale sin arqueo, con el esperado en vivo). Tres hojas: el arqueo, el detalle de movimientos y
el resumen por etiqueta.

Es el reemplazo del "imprimir el cierre": se imprime igual y además el contador lo puede sumar aparte.
Pone el botón en el detalle del turno y en cada fila del historial.

```js
const res = await fetch(`${API}/cash-register/${id}/export`, { credentials: "include" });
if (!res.ok) throw new Error((await res.json()).error.code);

// El nombre viene del backend (caja-turno-7-2026-07-29.xlsx) y está expuesto por CORS.
const cd = res.headers.get("Content-Disposition") ?? "";
const filename = cd.match(/filename="(.+?)"/)?.[1] ?? `caja-turno-${id}.xlsx`;

const url = URL.createObjectURL(await res.blob());
Object.assign(document.createElement("a"), { href: url, download: filename }).click();
URL.revokeObjectURL(url);
```

Dos detalles: **no le pongas `Accept: application/json`** al request, y si usás un wrapper de fetch que
parsea JSON automáticamente, saltealo para esta ruta. Los errores (404 del flag o del turno) **sí**
vienen como JSON con el shape de siempre, así que chequeá `res.ok` antes de tratarlo como blob.

**El mes entero**: `GET /cash-register/export?from=2026-07-01&to=2026-07-31` — mismo mecanismo de
descarga, tres hojas (un renglón por turno, todos los movimientos del período, y los totales). Es el
archivo que se le pasa al contador. Las fechas van como `YYYY-MM-DD` y el backend las toma como
**días locales completos**: el `to` incluye todo ese día, así que `to=2026-07-31` sí trae el 31.

---

## 5.2 Turnos con horario: se abre solo, no se cierra solo

Si el tenant carga `cashSchedule` en su config (`PATCH /tenant-config/:id` — **esto sí lo edita él**),
la caja se abre sola:

```json
{ "cashSchedule": [
  { "label": "Mañana", "from": "08:00", "to": "14:00" },
  { "label": "Tarde",  "from": "14:00", "to": "20:00" },
  { "label": "Noche",  "from": "20:00", "to": "02:00" }
]}
```

`to < from` significa que cruza la medianoche (turno noche). Hasta 6 turnos, **sin solaparse** — si se
pisan, el PATCH da 400 con el mensaje en `errors.cashSchedule`. `null` o `[]` = sin horario, todo
manual. Validá el solape en el form para no depender del roundtrip.

**Qué cambia en la UI:**

- **`GET /current` puede abrir el turno** al pedirlo. Si el horario está vigente y no había ninguno
  abierto, la respuesta ya viene con el turno nuevo (`trigger: "AUTO"`), abierto con el efectivo
  contado en el cierre anterior. No hace falta que el usuario apriete nada.
- El turno trae **`trigger`** (`"MANUAL"` | `"AUTO"`), **`label`** (el nombre del turno) y
  **`expiresAt`**. Mostrá el nombre: "Turno Tarde" dice más que "Turno #482".
- **`vencido: true` + `vencidoHaceMinutos`**: el turno pasó su hora y sigue abierto. Es la señal para
  un banner "cerrá la caja" — no un error, y no lo cierres automáticamente desde el front.
- **El cierre nunca es automático.** Si nadie cierra un turno vencido y ya empezó el siguiente, el
  backend lo cierra **sin conteo**: esa fila queda con `closedWithoutCount: true`,
  `countedCashAmount: null` y `cashDifference: null`. Pintalo distinto de un cierre normal ("sin
  arqueo"), nunca como "diferencia 0" — no cuadró y nunca se contó son cosas distintas.

## 6. Los cobros de las órdenes caen solos

Cada cobro registrado en una orden (seña, transferencia confirmada, cobro total, devolución) genera
**automáticamente** un movimiento en el turno abierto, salvo los de MercadoPago (`GATEWAY`), que no
pasan por el cajón. No hay nada que hacer desde el frontend: aparecen en `movements` con su `type`
`ORDER_*`, su `orderId` y sin etiqueta.

Corolario importante, y **cambio de comportamiento en el flujo de órdenes** con la caja habilitada:

> Confirmar un cobro en efectivo o por transferencia **sin turno abierto falla** con
> `409 CASH_SESSION_NOT_OPEN`, y la orden **no queda cobrada**. Lo mismo al pasar una orden en efectivo
> a `COMPLETED` (donde el cobro se registra solo: "entregar es cobrar").

Manejalo en las pantallas de órdenes: si aparece ese código, el mensaje útil es *"Abrí la caja antes de
cobrar"* con un link al módulo — no un error genérico. Completar una orden **ya cobrada** no exige
turno abierto (no hay plata nueva que anotar).

---

## 7. Reporte por etiqueta

```http
GET /cash-register/summary?from=2026-07-01&to=2026-07-31
```

```json
{
  "byType":    { "ORDER_PAYMENT": 850000, "EXPENSE": -128000, "INCOME": 4000 },
  "byChannel": { "CASH": 610000, "TRANSFER": 116000 },
  "byCategory": {
    "sueldos": { "categoryId": 1, "label": "Sueldos", "total": -100000, "count": 4 },
    "insumos": { "categoryId": 2, "label": "Insumos", "total": -28000, "count": 9 }
  }
}
```

Cruza turnos: es el reporte del mes, no del turno. `byCategory` incluye **solo los movimientos
manuales** (los de órdenes no tienen etiqueta y se leen en `byType`), así que no esperes que
`Σ byCategory == Σ byType`.

---

## 8. Códigos de error

| Código | HTTP | Qué mostrar |
|---|---|---|
| `CASH_REGISTER_DISABLED` | 404 | Ocultar el módulo (no debería llegar acá si chequeaste el flag) |
| `CASH_SESSION_ALREADY_OPEN` | 409 | "Ya hay una caja abierta" — refrescá `/current` |
| `CASH_SESSION_NOT_OPEN` | 409 | "Abrí la caja antes de cobrar / registrar movimientos" |
| `CASH_SESSION_NOT_FOUND` | 404 | Turno inexistente |
| `CASH_CATEGORY_KIND_MISMATCH` | 400 | La etiqueta no aplica a ese tipo — filtrá el picker (§4) |
| `CASH_CATEGORY_INACTIVE` | 409 | Etiqueta desactivada: recargá el catálogo |
| `CASH_CATEGORY_NOT_FOUND` | 404 | Recargá el catálogo |
| `CASH_CATEGORY_DUPLICATE` | 409 | "Ya existe una etiqueta con esa clave" |
| `CASH_CATEGORY_RESERVED` | 400 | Se tocó una etiqueta del sistema: filtrala del picker, y en el ABM permitile solo renombrar |
| `CASH_CATEGORY_IN_USE` | 409 | No se puede borrar: ofrecé **desactivar** (`isActive: false`) |

Todos con el shape estándar: `{ "error": { "message", "code", "details"? } }`.

---

## 9. En el dashboard: `cobranzas` y `caja`

`GET /stats/dashboard` (`body.dashboard`) trae dos secciones nuevas, además de un KPI:

```jsonc
{
  "kpis": {
    "revenue":   { "current": 850000, "previous": 700000, "changePct": 21.43 }, // facturado
    "collected": { "current": 812000, "previous": 690000, "changePct": 17.68 }  // cobrado (nuevo)
  },

  "cobranzas": {
    "facturado": 850000,   // órdenes COMPLETED del período
    "cobrado":   812000,   // plata que entró, NETA de devoluciones
    "brecha":     38000,   // facturado − cobrado
    "devuelto":    2000,
    "cobros":        47,   // cantidad de cobros (no cuenta devoluciones)
    "porVia": { "CASH": 610000, "TRANSFER": 116000, "GATEWAY": 86000 }
  },

  // null si el tenant no tiene el módulo de caja habilitado.
  "caja": {
    "turnos": 62, "turnosCerrados": 61, "turnoAbierto": true,
    "ingresosManuales": 4000,
    "egresos": -128000,                       // negativo
    "egresosPorEtiqueta": [                   // de mayor egreso a menor
      { "key": "sueldos", "categoryId": 1, "label": "Sueldos", "total": -100000, "count": 4 },
      { "key": "insumos", "categoryId": 2, "label": "Insumos", "total": -28000, "count": 9 }
    ],
    "diferenciaAcumulada": -350,              // suma de arqueos; negativo = faltó plata
    "turnosConDiferencia": 7,
    "turnosSinArqueo": 2,                     // cerrados por vencimiento, sin conteo
    "resultadoAproximado": 688000
  }
}
```

Cómo leerlo en la UI:

- **`brecha` positiva** = se entregó más de lo que se cobró (una transferencia que nadie confirmó, un
  saldo de seña sin cerrar). **Negativa** = entró plata de algo que todavía no salió, lo normal en un
  tenant que cobra seña. No la pintes como "error" en ninguno de los dos casos: es información.
- **`caja: null` no es cero.** Si el tenant no lleva caja, no muestres el bloque — cero egresos por no
  llevar caja no es lo mismo que cero egresos.
- **`resultadoAproximado` = cobrado − egresos + ingresos manuales.** Si lo mostrás, aclarale al usuario
  que **no es un resultado contable**: no descuenta el costo de la mercadería (el sistema no lo tiene)
  y las dos ventanas no son idénticas (los cobros se cuentan por fecha, los turnos por apertura, ver
  `meta.criteria`). "¿Me quedó plata este mes?" sí; "¿gano dinero?" no.
- **`diferenciaAcumulada`** es el dato que sirve para una alerta: si viene siempre negativa, hay algo
  que revisar en la operación. Y mirá **`turnosSinArqueo`** al lado: si crece, la diferencia acumulada
  vale cada vez menos, porque hay turnos que nadie contó.
- **Varios turnos por día es normal** (mañana, tarde, noche): `turnos: 62` en 30 días no es un bug.

## 10. Detalles que ahorran un ida y vuelta

- **`key` de etiqueta**: slug en minúsculas, `^[a-z0-9]+(-[a-z0-9]+)*$` (`insumos`,
  `aporte-cambio`). Generalo desde el `label` en el form, pero mostralo — es lo que va a ver en los
  reportes.
- **No ofrezcas borrar etiquetas usadas**: si `count > 0` en el summary, el botón útil es
  "desactivar". Borrar solo funciona con las que nunca se usaron.
- **El catálogo arranca con 7 etiquetas propias** sembradas al habilitar la caja (`sueldos`,
  `insumos`, `proveedores`, `servicios`, `retiro`, `aporte-cambio`, `ajuste`) **más 2 reservadas**
  (`venta`, `devolucion`, con `isSystem: true`). No hace falta pantalla de onboarding.
- **En el ABM de etiquetas, las `isSystem` van con el botón de borrar y el switch de activo
  deshabilitados**, y solo editable el nombre. Cualquier otra cosa devuelve 400.
- **No hay conteo por denominación de billete.** Se declara un total y listo.
- **Cancelar una orden ya cobrada NO genera una devolución automática en la caja.** Si el negocio
  devuelve la plata, es un movimiento manual (`EXPENSE`, etiqueta "Ajuste" o similar) o una devolución
  registrada en la orden. Es a propósito: enganchar la cancelación significaría que cancelar puede
  fallar por no haber caja abierta.
