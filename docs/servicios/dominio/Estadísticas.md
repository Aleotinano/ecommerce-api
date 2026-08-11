---
tags: [servicio, dominio/estadisticas]
estado: estable
ultima-revision: 2026-07-30
lado: backend
---

# Estadísticas

## Propósito
Dashboard de KPIs y ranking de productos para el panel admin, genérico por tenant: revenue, órdenes
completadas, ticket promedio, unidades vendidas, clientes activos, tendencia diaria, estado de
órdenes, revenue por categoría y ranking de productos con stock bajo. Desde 2026-07-30 también
**cuánta de esa plata entró de verdad y cuánta salió del local** — ver [[#Cobranzas y caja]].

## Modelo de datos
No tiene modelo propio — agrega datos de `Order`/`OrderItem`/`Product` (ver [[Órdenes]] y
[[Productos]]) más `OrderPayment` y los turnos de [[Caja]], sobre una ventana de tiempo.

## Reglas de negocio / invariantes
- **Endpoint único**: `GET /stats/dashboard?days=&lowStockThreshold=`
  (`schemas/stats.schema.js:StatsQuery` — `days` entre 7 y 365, default 30; `lowStockThreshold` entre
  0 y 1000, default 5).
- **`StatsModel.getDashboard`** (`services/stats.js:16-113`) compara el período actual vs. el período
  anterior de igual longitud, usando `startOfDay`/`addDays` (`services/stats/utils.js`, reusadas
  también por [[Sugerencias de contenido]]).
- **KPIs** (con variación % actual/anterior vía `buildMetric`): `revenue`, `completedOrders`,
  `averageOrderValue`, `unitsSold`, `activeCustomers`.
- **Gráficos**: `dailyTrend` (serie diaria de revenue), `orderStatus` (panel por estado),
  `revenueByCategory`.
- **Ranking**: top 5 productos (`rankingSize: 5` fijo en `meta.criteria`) con flag de stock bajo
  según `lowStockThreshold`.
- **`revenueBasedOn: "COMPLETED_ORDERS"`** — el revenue de KPIs y gráficos se basa únicamente en
  órdenes completadas, nunca en `NEW`/`PROCESSING`/`READY`. Una orden **lista pero no entregada**
  todavía no es venta. (`NEW` se llamaba `PENDING` hasta 2026-07-31, ver [[Órdenes]].)
- **El panel de estados cubre todo el enum, y ya no a mano.** `ORDER_STATUS_KEYS`
  (`services/stats/constants.js`) dejó de ser una lista propia: es `ORDER_STATUS_CODES`, del catálogo
  de [[Órdenes]] (`services/order-status.js`). Tiene que listar los cinco estados de `OrderStatus`,
  `READY` incluido, porque `buildOrderStatusPanel` arma
  la distribución mapeando esa lista, así que un estado que falte suma al `totalOrders` pero no
  aparece en el panel y los porcentajes dejan de cerrar en 100.

## Cobranzas y caja

> [!success] Implementado 2026-07-30
> `services/stats/money.js` (puro) + dos queries más en `services/stats/queries.js`. Tests:
> `tests/stats-money.test.js` (sin base) y `tests/stats-cash.test.js`.

Hasta acá el dashboard sabía de **facturación** y no de **plata**: no distinguía una orden entregada y
cobrada de una entregada con la transferencia sin confirmar, y no sabía por qué vía entró nada. Con el
libro de cobros de [[Órdenes]] y los turnos de [[Caja]] eso se puede responder.

**`kpis.collected`** — plata que entró en el período, neta de devoluciones, con comparación contra el
período anterior. Va al lado de `revenue` (facturado) a propósito: la comparación entre los dos es el
dato nuevo.

**`cobranzas`** — `{ facturado, cobrado, brecha, devuelto, cobros, porVia }`.

- **`brecha` = facturado − cobrado.** Es el número que antes no existía. **Positivo**: se entregó más
  de lo que se cobró (una transferencia que nadie confirmó, un saldo de seña sin cerrar).
  **Negativo**: entró plata de algo que todavía no salió — lo normal en un tenant que produce a
  pedido y cobra seña.
- **`porVia`** (`CASH`/`TRANSFER`/`GATEWAY`) contesta "¿cuánto manejé en efectivo este mes?", que es
  una pregunta distinta de "¿cuánto vendí?".

**`caja`** — `null` si el tenant no tiene el módulo habilitado, y **no** un panel en cero: cero
egresos por no llevar caja no es lo mismo que cero egresos. Cuando existe:
`{ turnos, turnosCerrados, turnoAbierto, ingresosManuales, egresos, porEtiqueta,
egresosPorEtiqueta, diferenciaAcumulada, turnosConDiferencia, turnosSinArqueo,
resultadoAproximado }`.

- **`porEtiqueta`** cubre **toda** la plata desde que los movimientos de orden llevan etiqueta
  reservada ("Venta", "Devolución"): su suma coincide con el neto. **`egresosPorEtiqueta`** es el mismo
  eje filtrado a lo que sale, ordenado de mayor egreso a menor — se mantiene aparte justamente porque
  ahora en el otro también están las ventas, y "en qué se va la plata" no puede empezar con una fila
  gigante de ingresos.
- **`diferenciaAcumulada`** suma las diferencias de arqueo de los turnos **cerrados** del período, y
  `turnosConDiferencia` cuenta cuántos no cerraron exactos. Es la respuesta a "¿este turno cierra
  siempre corto?".
- **`resultadoAproximado` = cobrado − egresos + ingresos manuales.** Es un resultado **de caja**: la
  mercadería está incluida si se carga como egreso. Sirve para "¿me quedó plata este mes?" y **no**
  para un balance — la mercadería pesa el día que se compró (no el día que se vendió), no está atribuida
  a ningún producto, y las dos ventanas no son la misma (ver abajo).

### Dos ventanas distintas, a propósito

Declaradas en `meta.criteria` para que quien lea el payload no tenga que adivinar:

| Criterio | Qué significa |
| --- | --- |
| `revenueBasedOn: "COMPLETED_ORDERS"` | el facturado son órdenes completadas de la ventana |
| `collectedBasedOn: "PAYMENT_CONFIRMED_AT"` | los cobros se cuentan por **cuándo entró la plata**: una orden de marzo cobrada en abril es plata de abril, que es justamente la brecha |
| `cashBasedOn: "SESSION_OPENED_AT"` | los turnos de caja se cuentan **enteros**, por cuándo se **abrieron** |

Lo último es una decisión de negocio, no técnica, y la definió el cliente: **la unidad es el turno, no
el día**. Un local abre tres turnos en un día (mañana, tarde y noche) y el de la noche cierra después
de medianoche. Un turno **no se parte** por fecha: cuenta en el día en que se abrió, que es como se lo
nombra ("el turno noche del sábado"), y sus movimientos de la madrugada entran igual en él.

## Endpoints

| Método | Ruta | Qué hace | Auth / rol |
| --- | --- | --- | --- |
| GET | `/stats/dashboard` | Dashboard completo (KPIs + cobranzas + caja + gráficos + ranking) | `verifyToken` + `ADMIN`/`STAFF` |

## Dependencias
- [[Órdenes]] — fuente de revenue/unidades/clientes (órdenes completadas de la ventana) y del libro de
  cobros (`OrderPayment`) para las cobranzas.
- [[Caja]] — turnos y movimientos del período. La dependencia es de una sola dirección: la caja no
  sabe que existe este dashboard.
- [[Productos]] — ranking y stock bajo.
- [[Sugerencias de contenido]] — reusa las utilidades de ventana temporal (`startOfDay`/`addDays`).
- [[Multi-tenancy]] — todo scoping por `req.tenantId`.

## Integraciones externas
Ninguna directa.

## Deuda técnica / cosas raras
Etiquetas por tipo de acción — ver convención en [[App]].

- `[riesgo]` **`activeCustomers` puede sub-representar tenants que usan el bot de WhatsApp.** Se
  calcula con `new Set(orders.map(o => o.userId))` (`services/stats.js:36-41`) — todas las órdenes
  con `userId: null` (origin `BOT`) colapsan en una única entrada del Set (`null`), distorsionando el
  conteo cuando hay mezcla de órdenes `ADMIN` (con usuario) y `BOT` (sin usuario).
- `[riesgo]` **Los KPIs y gráficos históricos siguen sin test dedicado.** `tests/stats-cash.test.js`
  cubre las secciones nuevas (`cobranzas`, `caja`, `kpis.collected`) y `tests/stats-money.test.js` la
  aritmética, pero `revenue`/`dailyTrend`/`revenueByCategory`/ranking nunca tuvieron uno — conviene
  validar ese output a mano contra el catálogo real antes de depender de él en producción.
- `[nota]` **`resultadoAproximado` mezcla dos ventanas** (cobros por fecha, egresos por turno) y
  atribuye la mercadería al día que se **compró**, no al que se vendió: una compra grande hunde una
  ventana corta y regala la siguiente. En un mes cerrado se compensa; en un turno o una semana, no. Si
  el cliente empieza a tomar decisiones con ese número, la conversación es costo por producto, no
  refinar la fórmula.

## Preguntas abiertas / mejoras candidatas
- ¿Cómo debería contarse "clientes activos" para tenants que operan mayormente por WhatsApp
  (`contactPhone`/`contactName` en vez de `userId`)? Hoy esas órdenes no suman a `activeCustomers`.
