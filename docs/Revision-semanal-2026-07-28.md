---
tags: [revision-semanal]
fecha: 2026-07-28
---

# Revisión semanal — 2026-07-28

Fecha: 2026-07-28

## Resumen ejecutivo

Semana con más código que las anteriores: checkout completo del storefront (entrega, forma de pago, desglose mixto, deep-link de WhatsApp), `confirmPayment` para cerrar `PAID_IN_FULL` a mano, y una libreta de direcciones (`Direcciones`) nueva. Tres hallazgos viejos se resuelven o se aclaran esta semana: el índice ([[App]]) ya no describe el modelo de 3 tipos de producto, la whitelist manual de `TenantConfig.update` quedó eliminada por el refactor `85f0013`, y la "sobreventa por concurrencia" de [[Órdenes]] resultó no ser un bug — el decremento de stock ya es un `UPDATE` condicional atómico. A cambio aparecen bugs nuevos: el checkout web ignora la seña del tenant, una inconsistencia real de ruta entre ARCHITECTURE.md y [[Roles]], y que la nueva [[Direcciones]] no está reflejada ni en [[Órdenes]] ni en el índice [[App]]. La Auditoría de producción del 07-22 señala el "combo cerrado" (sin selección) como la brecha de producto más importante detectada hasta ahora. Sigue sin existir recuperación de contraseña, y quedan 10 documentos TBD (antes había además Roles/MercadoPago/Estadísticas sin documentar; ya están completos).

## Verificación end-to-end del motor de estados (2026-07-29)

El rediseño de estados + libro de cobros se caminó por HTTP contra `mesa-dulce` en dev, no solo por
tests. Lo que se confirmó y lo que apareció:

- **Anda:** el avance automático (revisar/confirmar un cobro deja la orden en `PROCESSING` sola, con
  la fila `automatico: true` en el timeline), `blockers`/`canProduce`/`payment` en lista y detalle
  con `estimated: false`, el libro y el `pending` por vía de las órdenes sembradas, y los códigos de
  error de siempre (`ORDER_ALREADY_COMPLETED`, `INVALID_STATUS_TRANSITION`, `TRANSFER_NOT_APPLICABLE`).
- **Apareció y se arregló:** una orden en efectivo llegaba a `COMPLETED` con el libro vacío
  (ver "Entregar es cobrar" en [[Órdenes]]), y `POST /orders/:id/payments` aceptaba devolver más de
  lo cobrado, dejando `paid` negativo y todos los derivados mintiendo.
- **Detalles que conviene saber:** `PAYMENT_CHANNEL_REQUIRED` no es alcanzable vía `confirm-deposit`
  en un tenant sin seña (gana `DEPOSIT_NOT_REQUIRED`); la respuesta de `POST /store/orders` **no**
  trae `blockers` a propósito (es respuesta de cliente); y las órdenes sembradas quedan en `PENDING`
  con `canProduce: true`, porque el seed escribe el estado directo y el avance automático solo corre
  sobre mutaciones.

## Perfiles de flujo de venta (2026-07-29)

Segunda tanda del mismo día. El motor de estados ya soportaba los tres flujos del negocio (contra
entrega, transferencia adelantada, producción contra seña), pero **qué métodos acepta cada tenant no
era configurable**: los enums de Zod valían para todos, así que un tenant que solo vende contra
entrega igual aceptaba una orden por transferencia.

- `TenantConfig` gana `paymentMethodsEnabled` y `fulfillmentMethodsEnabled` (arrays de enum, con
  defaults que reproducen el comportamiento anterior — ningún tenant existente cambia).
- Esos dos campos más `depositEnabled`/`depositPercentage` pasan a ser **de solo lectura para el
  tenant**: el flujo de venta lo configuramos nosotros. **Cambio de contrato**: `deposit*` era
  editable por `PATCH /tenant-config/:id` y ahora da 400.
- `services/tenant-profiles.js` (puro) define tres perfiles y los aplica `UserModel.register` o
  `node prisma/set-tenant-profile.js <slug> <perfil>`. Mesa Dulce usa `estandar`, que es el default:
  no necesitó un perfil a medida.
- **Resuelto de paso:** el hueco de §11 de que el checkout web ignoraba la seña del tenant.

## Bugs y fixes sugeridos

- **[Alta] Checkout del storefront ignora la seña del tenant.** `OrderModel.create` no lee `TenantConfig.depositEnabled`: una orden creada por `/store/orders` sale con `requiresDeposit: false` aunque el tenant tenga seña activa, y esquiva el guard `DEPOSIT_NOT_CONFIRMED`. Solo `createDraft` (bot) y `reviewOrder` calculan `depositAmount`. Detectado por el propio equipo al implementar el checkout (07-26), dejado sin resolver a propósito porque cambia el comportamiento de pagos. — [[Órdenes]]
- **[Media] Inconsistencia de ruta entre ARCHITECTURE.md y [[Roles]] para editar el rol de un usuario.** ARCHITECTURE §6 documenta `PATCH /users/:id` (`routes/role.js`); [[Roles]] documenta `PATCH /role/:id`. Uno de los dos documentos está mal — hay que verificar contra `routes/role.js` y corregir el que no coincida. — ARCHITECTURE.md §6, Roles
- **[Media] [[Órdenes]] no refleja la [[Direcciones]] nueva (07-27).** La sección de deuda técnica de Órdenes sigue diciendo "no hay direcciones guardadas por usuario, decisión explícita de scope" y no lista `Direcciones` en Dependencias — desde el 07-27 sí existe la libreta (`UserAddress`), aunque deliberadamente desacoplada de la orden. El doc quedó desactualizado, no el código. — Órdenes, Direcciones
- **[Baja] [[App]] (índice) no lista [[Direcciones]].** El nuevo servicio de dominio (implementado, con tests) no aparece ni en la lista de "Servicios de dominio" ni en "Documentados" del índice. — App
- **[Baja] [[Roles]] sin protección de lock-out.** `roleModel.edit` no impide que el único `ADMIN` de un tenant pierda ese rol (ni que se autodegrade); un tenant podría quedar sin ningún `ADMIN`. — Roles
- **[Baja] `activeCustomers` de [[Estadísticas]] subestima tenants con ventas por WhatsApp.** Se calcula con `new Set(orders.map(o => o.userId))`; todas las órdenes `BOT` (`userId: null`) colapsan en una sola entrada del Set, distorsionando el conteo. — Estadísticas
- **[Baja] Logs con encoding corrupto en [[MercadoPago]].** Varios `console.log`/`console.error` de `services/mercadopago.js` tienen mojibake (`"no aprobado todav�a"`, etc.) — probablemente el archivo fuente no está en UTF-8 consistente. — MercadoPago
- **[Nota] Migración `add_promos` (20260723022006, descuento por cantidad) sin documento de dominio.** Existe en `prisma/migrations` y se menciona en ARCHITECTURE §3, pero ningún doc de `servicios/` explica qué hace ni cómo se relaciona con [[Productos]]/[[Órdenes]] — vacío documental, no necesariamente bug de código. — ARCHITECTURE.md §3

## Propuestas de features y mejoras

1. **[Alta] Combo cerrado (contenido fijo, sin selección).** Señalado en la Auditoría de producción de Mesa Dulce (07-22) como la brecha más importante encontrada: hoy TODO combo obliga al cliente a elegir componentes de una whitelist; no hay un modo de combo con contenido fijo que se agregue al carrito como un producto simple. Toca schema, carrito, orden y checkout. — Combos, Auditoria-Mesa-Dulce-Produccion-2026-07-22
2. **[Alta] Recuperación de contraseña.** Tercera semana consecutiva sin este endpoint — cualquier cliente o admin que olvide su clave queda bloqueado. Brecha operativa relevante ahora que hay un cliente real con datos en producción.
3. **[Media] Enforcement automático de `tenantId` a nivel de Prisma.** El propio equipo lo señala como riesgo estructural desde hace semanas; la Auditoría de producción (07-22) lo vuelve más urgente porque ya hay un cliente pagando con datos reales. — Multi-tenancy, Auditoria-Mesa-Dulce-Produccion-2026-07-22
4. ~~**[Media] Cerrar el circuito de `PaymentStatus.REFUNDED`.**~~ **Resuelto (07-29):** `derivePaymentStatus` traduce la devolución total a `REFUNDED` (evaluada antes que `APPROVED`), `paymentSummary` expone `charged`/`refunded`, y `registerPayment` rechaza devolver más de lo cobrado (`REFUND_EXCEEDS_PAID`). Queda abierta solo la devolución parcial, que se ve como `DEPOSIT_PAID`. — MercadoPago, Órdenes
5. **[Media] Documentar el sistema de promos/descuento por cantidad.** Ya implementado (migración `add_promos`), pero no hay doc de dominio ni se sabe si interactúa con combos o con el pricing de [[Órdenes]].
6. **[Baja] Sistema de cupones/descuento genérico.** La promo por cantidad ya existe, pero un cupón de código sigue ausente — feature estándar de e-commerce comparable.
7. **[Baja] Reviews/ratings de producto.** Sigue sin existir en el modelo de datos ni en ningún doc de dominio.
8. **[Baja] Búsqueda de catálogo más allá de `name`.** Sin full-text ni tolerancia a errores de tipeo.
9. **[Baja] Definir `allowCartGuest`: implementar o remover.** El flag sigue sin efecto real en `middleware/guestCart.js` — o se cablea o se saca de [[TenantConfig]].

## Pendientes de semanas anteriores

Resueltos o aclarados esta semana (ya no aplican):
- Índice/log de demo desactualizados sobre el modelo de tipos de producto — [[App]] ya documenta PRODUCTO/COMBO correctamente; "mesa dulce demo" se autoseñaliza como obsoleto con warnings en línea.
- Whitelist manual de `TenantConfig.update` (falla en silencio si se olvida un campo nuevo) — eliminada estructuralmente por el refactor `85f0013`.
- Sobreventa por concurrencia en stock — aclarado: el decremento es un `UPDATE` condicional atómico (`WHERE stock >= quantity`), no una condición de carrera pendiente. — Órdenes, Combos

Siguen abiertos:
- `TenantConfig.allowCartGuest` sin efecto real (confirmado, no solo "sin respaldo visible"). — Carrito, TenantConfig
- `showOutOfStock` solo confirmado en el bot, no aclarado para `GET /store/products`. — Productos, Chat de tienda
- `productVariantsEnabled` sin validación cruzada. — Productos
- Naming ambiguo en `GET /orders` (devuelve las propias, no las del tenant). — Órdenes
- `GET /tenant-config/:tenantId` (admin) sin auth obligatoria (`attachUser`, no `verifyToken`). — TenantConfig
- `extraData` de `updateOrderStatus` sin validar por schema. — Órdenes, MercadoPago
- Cost-guard de LLM no cubre `getToday` (push diario sin descontar cuota). — Sugerencias de contenido
- Ventana de ventas atada a `createdAt`, no a fecha de completado. — Sugerencias de contenido
- Cache de catálogo no se invalida al editar variantes (hasta 3 min de desfasaje). — Variantes
- `reviewOrder` no re-valida límites de combo al corregir cantidades. — Órdenes, Combos
- Comentario desactualizado sobre el unique de sugerencias (dice 2 columnas, son 4). — Sugerencias de contenido
- Asimetría de auth admin/store (`verifyToken` solo cookie, no acepta Bearer). — ARCHITECTURE §11, Auth y tokens
- Ruta de debug expuesta `GET /test/:id`.
- Columnas combo legacy sin limpiar (`Product.isCombo`). — Productos
- Sin scoping de tenant automático a nivel de Prisma (riesgo estructural, ver también propuesta #3 arriba). — Multi-tenancy
- Implementar "Sugerencias de contenido — Imágenes": progreso real esta vez (cliente de imagen, pipeline de prompt y modelo `SuggestionImage` ya implementados y testeados), pero sigue sin exponerse por HTTP (sin endpoints, sin cost-guard de imagen). — Sugerencias de contenido — Imágenes (propuesta)
- Cablear o quitar `SuggestionStatus` (decisión ya tomada: se cablea; implementación pendiente). — Sugerencias de contenido
- Cola (BullMQ u otra) para el webhook de WhatsApp (fire-and-forget in-process). — WhatsApp
- Soporte de combos en el bot de WhatsApp (diferido a propósito). — Combos, Chat de tienda
- Notificaciones proactivas por WhatsApp ante cambios de estado de pedido. — WhatsApp, Mailer
- Endpoint de cantidad exacta en carrito. — Carrito
- Permitir que el cliente cancele su propia orden en `PENDING`. — Órdenes
- Adapter OpenAI-compat para el cliente LLM del chat. — Chat de tienda, Cliente LLM
- `PATCH /products/:id/combo-options` incremental (hoy reemplaza toda la whitelist). — Combos
- Completar documentación TBD: 10 stubs restantes ([[Multi-tenancy]], [[Auth y tokens]], [[Usuarios y Auth]], [[Agente LLM]], [[Cliente LLM]], [[Crypto]], [[Mailer]], [[Rate limiting]], [[Redis y cache]], [[Almacenamiento de imágenes]]) — [[Roles]], [[MercadoPago]] y [[Estadísticas]] ya salieron de esta lista.
