---
tags: [editflow, dominio, modelo-de-datos]
estado: propuesta
ultima-revision: 2026-10-03
---

# Dominio de EditFlow

La cadena que se pidió: **el administrador ve sus clientes → entra a un cliente y ve de
antemano si tiene un plan activo → entra a la tanda y ve cómo viene cada video.** Un cliente
pide videos sueltos o tandas; a la tanda se le aplica un precio con descuento.

## 1. Entidades

```
Agency ─┬─ User (OWNER | ADMIN | EDITOR)
        ├─ Service ── PriceTier            lista de precios
        └─ Client ─── Batch ─── Video ─── VideoEvent
             │          │         │
             │          │         └─ editorId → User
             │          └─ snapshot de precio
             └─ leadEditorId → User        el editor responsable del cliente
```

| Entidad | Campos clave | Notas |
| --- | --- | --- |
| `Agency` | `slug`, `name`, `currency` | El tenant |
| `User` | `agencyId`, `email`, `name`, `role`, `isActive` | Editores incluidos. Desactivar, nunca borrar (tienen historial) |
| `Client` | `agencyId`, `name`, `contactName`, `whatsapp`, `email`, `instagram`, `notes`, `status` (`ACTIVE`/`PAUSED`/`ARCHIVED`), `leadEditorId?` | El editor responsable. Cada video puede tener otro |
| `Service` | `agencyId`, `name` ("Reel", "Video YouTube 10 min"), `unitPrice`, `isActive` | La lista de precios |
| `PriceTier` | `serviceId`, `minQty`, `discountPct` | Escalones: desde 4 videos −10 %, desde 8 −15 % |
| `Batch` (tanda) | `agencyId`, `clientId`, `serviceId`, `kind` (`SINGLE`/`PACK`/`MONTHLY`), `quantity`, `unitPrice`, `discountPct`, `subtotal`, `total`, `status`, `startsAt`, `dueAt?`, `periodEnd?` | **Snapshot**: precio y descuento se copian al crear. Un video suelto es una tanda de 1 |
| `Video` | `agencyId`, `batchId`, `position`, `title?`, `status`, `editorId?`, `revisionRound`, `rawUrl?`, `draftUrl?`, `finalUrl?`, `dueAt?`, `deliveredAt?` | Los links apuntan a Drive/Frame.io; el archivo no pasa por el sistema |
| `VideoEvent` | `videoId`, `from?`, `to`, `byUserId`, `note?`, `createdAt` | Historial de estados + comentarios de revisión |

`agencyId` va **también** en `Video` aunque se pueda derivar por la tanda: es lo que permite
filtrar el tablero de videos por agencia con un índice, sin joins (mismo criterio que Cori,
que lo repite en cada tabla).

## 2. El video: estados

```
PENDIENTE_MATERIAL ──► EN_EDICION ──► EN_REVISION ──► APROBADO ──► ENTREGADO
                           ▲               │
                           └── CAMBIOS ◄───┘        (cada vuelta suma revisionRound)

cualquiera no terminal ──► CANCELADO
```

| Estado | Quién lo mueve | Condición |
| --- | --- | --- |
| `PENDIENTE_MATERIAL` | — | Inicial: el cliente todavía no mandó lo grabado |
| `EN_EDICION` | editor / admin | Necesita `rawUrl` (sin material no se edita) |
| `EN_REVISION` | editor | Necesita `draftUrl`: lo que el cliente va a mirar |
| `CAMBIOS` | admin (lo que pidió el cliente) | Necesita nota con los cambios. `revisionRound++` |
| `APROBADO` | admin | — |
| `ENTREGADO` | editor / admin | Necesita `finalUrl`. Sella `deliveredAt` |

Vive en `packages/shared/domain/video-state.ts`, **puro**, con la forma de
`services/order-state.js` de Cori:

```ts
VIDEO_TRANSITIONS: Record<VideoStatus, VideoStatus[]>
VIDEO_STATUS_LABEL: Record<VideoStatus, string>          // el único lugar con nombres visibles
canTransition(video, to): { ok: true } | { ok: false; code; message }
blockers(video, to): string[]                             // "¿qué le falta?", sin intentar el cambio
```

Así el panel puede mostrar "le falta el link del material" en vez de esperar un 409.

## 3. La tanda: estado derivado

El estado de la tanda **se deriva de sus videos**, no se edita a mano (es la lección del
`paymentStatus` de Cori, que se deriva del libro de cobros):

| Tanda | Regla |
| --- | --- |
| `ACTIVA` | Tiene al menos un video no terminal |
| `COMPLETA` | Todos sus videos `ENTREGADO` o `CANCELADO`, al menos uno entregado |
| `CANCELADA` | Todos `CANCELADO` |

Se guarda igual como columna (cache para filtrar por SQL) y la recalcula **un solo** helper
cada vez que cambia un video, dentro de la misma transacción.

**Progreso** = entregados / (total − cancelados). Es el número que se ve en la ficha del
cliente sin entrar a la tanda.

**"Plan activo"** de un cliente = tiene una tanda `ACTIVA` (o, si es `MONTHLY`, una cuyo
período cubre hoy). Se resuelve en la query del listado, para que se vea de antemano.

## 4. Precio de una tanda

`packages/shared/domain/pricing.ts`, puro:

```ts
quoteBatch({ unitPrice, quantity, tiers }) → { tier, discountPct, subtotal, discount, total }
```

- El escalón aplicable es el de mayor `minQty` que no supere la cantidad: es exactamente
  `pickPromoTier` de `services/promos.js` en Cori.
- Redondeo a pesos enteros, una sola vez, sobre el total.
- El front lo llama para mostrar el precio mientras se arma la tanda; la API lo **vuelve a
  calcular** al guardar (nunca confía en el total que manda el cliente) y guarda el resultado
  como snapshot.
- Un descuento manual (amigo, cliente grande) es un `discountPct` que pisa al del escalón,
  solo para `OWNER`/`ADMIN`, y queda en el historial.

## 5. Las pantallas y lo que consultan

| Pantalla | Qué muestra | Query principal |
| --- | --- | --- |
| **Dashboard** | Clientes activos · tandas en curso · videos por estado · videos que vencen esta semana · carga por editor | `dashboard.service` con `groupBy` |
| **Clientes** | Lista con: plan activo (sí/no + progreso), editor responsable, próximo vencimiento | `clients` + tanda activa en un solo query |
| **Cliente (riel)** | Ficha, tanda activa arriba, historial de tandas, contacto (WhatsApp) | — |
| **Tanda** | Sus videos con estado, editor y links; acciones de transición | — |
| **Videos (tablero)** | Todos los videos de la agencia por columna de estado; filtro por editor/cliente | Con `EDITOR`: solo los suyos |
| **Editores** | Por editor: clientes activos, videos en curso, en revisión, entregados en el mes | `groupBy editorId` |
| **Servicios** | Lista de precios + escalones | — |

"Qué editor tiene clientes activos" sale de dos lados y conviene mostrar los dos: los clientes
de los que es **responsable** (`Client.leadEditorId`) y los clientes de los videos que **está
editando** (`Video.editorId`).

## 6. Lo que se deja afuera de la v1, a propósito

- Subir video: se guardan links.
- Pagos y facturación (pregunta abierta: ¿se registra cobrado/pendiente?).
- Portal del cliente con login.
- Notificaciones por WhatsApp/email.
- Calendario de publicación.

Cada uno entra después como módulo sin tocar el núcleo.

## 7. Preguntas abiertas

Cambian el modelo; conviene cerrarlas antes de la migración inicial.

1. **"Plan activo"**: ¿suscripción mensual que se renueva (12 videos/mes), tanda que se compra
   una vez, o las dos? El modelo cubre las dos con `Batch.kind`, pero si solo existe una, se
   simplifica.
2. **Un video, ¿un solo editor?** ¿O hay pasos con personas distintas (uno corta, otro hace
   color)? Si es lo segundo, `Video.editorId` pasa a ser una tabla de tareas.
3. **¿Hay tope de rondas de cambios** por plan? Si sí, va en `Service` y la máquina de estados
   lo hace cumplir.
4. **¿El cliente entra al sistema** para ver el avance o aprobar? Define si `Client` tiene
   usuario y si hay rutas públicas por token (como el seguimiento de pedido sin cuenta de Cori).
5. **¿Se registran pagos?** Seña, cobrado, pendiente.
6. **¿Solo tu agencia o se vende a otras?** El modelo ya es multi-agencia; cambia si hace
   falta alta self-service, planes de suscripción del software, etc.
