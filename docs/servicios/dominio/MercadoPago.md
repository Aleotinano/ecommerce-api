---
tags: [servicio, dominio/pagos]
estado: estable
ultima-revision: 2026-07-29
lado: backend
---

# MercadoPago

## Propósito
Crea preferencias de pago de MercadoPago para una orden existente y procesa el webhook de pago para
marcarla `COMPLETED`/`APPROVED`. No es dueño del ciclo de vida de la orden — solo mueve
`paymentStatus`/`paymentId` vía el parámetro `extraData` de `OrderModel.updateOrderStatus` (ver
[[Órdenes]]).

## Modelo de datos
No tiene modelo propio — persiste sobre campos de `Order` (`prisma/schema.prisma`):
`mercadoPagoId` (único), `preferenceId`, `paymentStatus`, `paymentMethod`, `paymentId`. Desde
2026-07-29 el cobro además queda como una fila del libro de [[Órdenes]] (`OrderPayment` con
`channel: GATEWAY`), que es de donde sale `paymentStatus`.

## Reglas de negocio / invariantes
- **`mercadopagoModel.create`** (`services/mercadopago.js:16-99`) busca la orden por
  `{ id: orderId, userId, tenantId }` — **requiere `userId` no nulo**: una orden creada por el bot
  (`origin: "BOT"`, `userId: null`) no puede generar un link de pago de MercadoPago por esta vía
  (coherente con que esas órdenes usan el flujo de seña manual, ver [[Órdenes]] → "Flujo de seña /
  pedidos del bot").
- Rechaza si la orden está `CANCELLED` (`ORDER_CANCELLED`, 409) o si `paymentStatus === "APPROVED"`
  (`ORDER_ALREADY_PAID`, 409).
- Arma `items` de MP a partir de `variant.attributes`/`product`, con `external_reference = order.id`
  y `notification_url` apuntando a `${DEFAULTS.BASE_URL}/mercadopago/webhook`.
- Al crear la preferencia, persiste `mercadoPagoId`/`preferenceId` y pone
  `paymentStatus: "IN_PROCESS"` (`services/mercadopago.js:81-88`).
- **El webhook** (`getWebhook`, `services/mercadopago.js:101-148`):
  - Valida firma (`validateWebhookSignature`, `controllers/mercadopago.js:33-50`, requiere
    `MP_WEBHOOK_SECRET` en env).
  - Ignora pagos no `approved`.
  - Valida que `order.total === paymentInfo.transaction_amount` (`AMOUNT_MISMATCH`, 409).
  - Rechaza si la orden ya está `COMPLETED` (`ORDER_ALREADY_PAID`, 409).
  - Si todo pasa, **registra el cobro** en el libro de [[Órdenes]] (`OrderPayment` con
    `channel: GATEWAY`, monto = `transaction_amount`) y guarda el `paymentId`. `paymentStatus` pasa
    a `APPROVED` como consecuencia de esa fila (`derivePaymentStatus`), no por escritura directa.
  - **Después** intenta completar la orden (`updateOrderStatus`, `trigger: GATEWAY`), pero
    **best-effort**: si la orden tiene blockers —típico: una orden `STORE` que nadie revisó— loguea
    y devuelve `"PAID"` en vez de `"COMPLETED"`. El cobro ya quedó registrado igual.

> [!note] Por qué el intento es best-effort (2026-07-29)
> Antes esto era un `updateOrderStatus` pelado y pasaba por las mismas precondiciones que un cambio
> a mano: una orden pagada pero sin revisar lanzaba `ORDER_NOT_REVIEWED`, nadie atrapaba el error,
> MercadoPago recibía un 500 y reintentaba el webhook para siempre — con el cobro sin registrar. El
> orden importa: **primero se anota la plata, después se intenta mover el estado.** Que la plata
> entró es un hecho; que la orden esté en condiciones de producirse es otra cosa.

## Endpoints

| Método | Ruta | Qué hace | Auth |
| --- | --- | --- | --- |
| POST | `/mercadopago/:id` | Crea preferencia de pago (backoffice) | `verifyToken` |
| POST | `/store/mercadopago/:id` | Crea preferencia de pago (storefront) | `verifyStoreToken` |
| GET | `/mercadopago/success` \| `/failure` \| `/pending` | Back-urls informativas: solo loguean y devuelven texto plano | Público |
| POST | `/mercadopago/webhook` | Recibe notificación de pago, valida firma y actualiza la orden | `webhookLimiter`, sin auth de usuario (valida firma) |

## Dependencias
- [[Órdenes]] — mueve `paymentStatus`/`paymentId`/`mercadoPagoId`/`preferenceId` vía `extraData` de
  `updateOrderStatus`; nunca los toca el controller de órdenes directamente.
- [[Multi-tenancy]] — `tenantId` de la orden al buscarla.

## Integraciones externas
- **MercadoPago** (preferencias de pago + webhook de notificación).

## Deuda técnica / cosas raras
Etiquetas por tipo de acción — ver convención en [[App]].

- `[riesgo]` Los `console.log`/`console.error` del módulo tienen strings con caracteres corruptos
  (mojibake — ej. `"no aprobado todav�a"`, `"External reference inv�lida"`, `"Monto inv�lido"` en
  `services/mercadopago.js:107,115,134`), probablemente un problema de encoding del archivo fuente.

## Preguntas abiertas / mejoras candidatas
- ¿Debería soportarse un link de pago para órdenes `BOT`/`userId: null` (hoy `create` lo bloquea de
  forma implícita al buscar por `userId`), o el flujo de seña manual es intencionalmente el único
  camino de cobro para esas órdenes?
