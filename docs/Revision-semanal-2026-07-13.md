---
tags: [revision-semanal]
fecha: 2026-07-13
---

# Revisión semanal — 2026-07-13

Primera corrida de esta revisión automática (no hay `Revision-semanal-*` previo para comparar).

## Resumen ejecutivo

El backend está funcionalmente sólido para la demo de Mesa Dulce (213/213 tests, combos end-to-end), pero hay dos focos de riesgo recurrentes: concurrencia de stock en [[Órdenes]]/[[Combos]] (ya documentada como bug abierto) y whitelists/validaciones manuales que fallan en silencio ([[TenantConfig]], `extraData` de MercadoPago). Además, buena parte de la documentación transversal (auth, multi-tenancy, redis, crypto, mailer) sigue en estado `TBD`, lo que limita el alcance de esta auditoría en esas áreas. La feature de mayor valor pendiente es la propuesta ya especificada de imágenes generadas por IA para sugerencias de contenido.

## Bugs y fixes sugeridos

- **[Alta] Sobreventa por concurrencia en stock.** `OrderModel.updateOrderStatus` decrementa stock sobre un snapshot leído antes de abrir la transacción; dos completados simultáneos pueden pasar ambos el chequeo. Se agrava con combos (N componentes = N chances de carrera). Acción: lock pesimista (`SELECT ... FOR UPDATE`) o decremento condicional. — [[Órdenes]], [[Combos]]
- **[Alta] Whitelist manual de `TenantConfig.update` falla en silencio.** Ya causó un bug corregido esta revisión (campos no reflejados en la respuesta pese a persistirse). Cualquier campo nuevo que se agregue al schema/modelo y se olvide en el whitelist del controller se ignora sin error. Acción: derivar el whitelist de `updateTenantConfig.shape` (Zod). — [[TenantConfig]]
- **[Media] `GET /tenant-config/:tenantId` (admin) sin autenticación obligatoria.** Usa `attachUser` (auth opcional), no `verifyToken`: cualquiera con el `tenantId` numérico lee branding/contacto/políticas del tenant sin loguearse (el token de WhatsApp no se expone, el resto de la config sí). — [[TenantConfig]]
- **[Media] `extraData` de `updateOrderStatus` sin validar por schema.** Canal genérico que MercadoPago usa para inyectar `paymentStatus`/`paymentId`; confía en el caller sin endurecer la entrada. — [[Órdenes]], [[MercadoPago]]
- **[Media] Cost-guard de LLM no cubre el push diario.** Solo `generateForProduct`/`refineProductCopy` consumen `DAILY_LLM_LIMIT`; `getToday` puede invocar al LLM sin descontar cuota. — [[Sugerencias de contenido]]
- **[Media] Ventana de ventas atada a `createdAt`, no a fecha de completado.** `loadSelectionData` filtra `status: COMPLETED` pero acota por `createdAt` de la orden — una orden completada dentro de la ventana pero creada antes no cuenta, y viceversa. Sesga qué ángulo aplica. — [[Sugerencias de contenido]]
- **[Media] Cache de catálogo no se invalida al editar variantes.** `PATCH /variants/:productId/:id` no invalida `prod:*` (TTL 180s) — cambios de precio/stock/atributos tardan hasta 3 min en reflejarse en el storefront. — [[Variantes]]
- **[Media] `reviewOrder` no re-valida límites de combo al corregir cantidades.** Permite reescalar líneas hijas de un combo sin re-chequear `comboMinItems`/`comboMaxItems` del padre, pudiendo dejar la selección fuera de rango sin detectarlo. — [[Órdenes]], [[Combos]]
- **[Baja] Comentario desactualizado sobre el unique de sugerencias.** Dice `(tenantId, date)`; el real es compuesto de 4 columnas. Cosmético. — [[Sugerencias de contenido]]
- **[Baja] Asimetría de auth admin/store.** `verifyToken` (admin) solo lee cookie y no acepta `Authorization: Bearer` pese a existir `extractToken` en el mismo archivo. — ARCHITECTURE §11 / [[Auth y tokens]]
- **[Baja] Ruta de debug expuesta.** `GET /test/:id` devuelve claims del token (protegida por rol ADMIN); candidata a remover si no se usa activamente en producción.
- **[Baja] Columnas combo legacy sin limpiar.** `Product.isCombo`/`comboMinItems`/`comboMaxItems` (viejas) siguen en el schema tras el colapso de tipos, sin leerse. — [[Productos]]
- **[Riesgo estructural, sin severidad puntual] Sin scoping de tenant automático a nivel de Prisma.** Cada query depende de que el desarrollador agregue `tenantId` a mano; sigue siendo el mayor vector de fuga de datos entre tenants si algún método lo omite. — [[Multi-tenancy]] (doc en TBD)

## Propuestas de features y mejoras

1. **[Alta] Implementar "Sugerencias de contenido — Imágenes".** Ya está completamente diseñada (modelo de datos, endpoints, pipeline multi-etapa, cost-guard fail-closed) con decisiones cerradas — solo falta construirla. Alto valor: reemplaza el entregable de solo-texto por un asset publicitario listo para usar. — [[Sugerencias de contenido — Imágenes (propuesta)]]
2. **[Alta] Cablear o quitar `SuggestionStatus`.** El enum `USED`/`DISMISSED` existe pero ningún endpoint transiciona el estado; aprovechar el trabajo de imágenes para resolver esto junto con los dos bugs de cost-guard/ventana de ventas de esa misma feature. — [[Sugerencias de contenido]]
3. **[Media] Lock/decremento condicional de stock en `Órdenes`.** Cierra el bug de concurrencia de arriba; impacto directo en catálogo de alta rotación y combos.
4. **[Media] Cola para el webhook de WhatsApp (BullMQ u otra).** Hoy el procesamiento es fire-and-forget in-process; un mensaje se pierde sin reintento si el proceso muere entre el 200 y el envío. — [[WhatsApp]]
5. **[Media] Soporte de combos en el bot de WhatsApp.** Diferido a propósito en v1 (solo rechaza con mensaje amigable); es la brecha funcional más visible del canal conversacional frente al storefront. — [[Combos]], [[Chat de tienda]]
6. **[Media] Notificaciones proactivas por WhatsApp ante cambios de estado de pedido.** Hoy solo hay email; mejora de experiencia para clientes que ya compran por ese canal. — [[WhatsApp]], [[Mailer]]
7. **[Baja] Endpoint de cantidad exacta en carrito** (en vez de solo incrementar/decrementar de a 1). — [[Carrito]]
8. **[Baja] Permitir que el cliente cancele su propia orden en `PENDING`.** Hoy solo ADMIN/STAFF cambian estado; reduce carga operativa en cancelaciones simples. — [[Órdenes]]
9. **[Baja] Adapter OpenAI-compat para el cliente LLM del chat.** Permite probar el chat con tools contra Ollama en dev (hoy solo Gemini o Anthropic real sirven). — [[Chat de tienda]], [[Cliente LLM]]
10. **[Baja] `PATCH /products/:id/combo-options` incremental.** Hoy cualquier edición reemplaza toda la whitelist (delete+create); reduce riesgo de pisar cambios concurrentes en catálogos grandes. — [[Combos]]
11. **[Baja] Completar documentación TBD de mayor riesgo de seguridad primero:** [[Multi-tenancy]] y [[Auth y tokens]] ya concentran hallazgos de ARCHITECTURE.md (scoping manual, asimetría cookie/Bearer) pero siguen siendo stubs — documentarlos ayudaría a decidir si son bugs a corregir o comportamiento aceptado.

## Pendientes de semanas anteriores

No aplica — esta es la primera revisión generada.
