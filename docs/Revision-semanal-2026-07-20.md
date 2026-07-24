---
tags: [revision-semanal]
fecha: 2026-07-20
---

# Revisión semanal — 2026-07-20

Fecha: 2026-07-20

## Resumen ejecutivo

Ningún bug de la revisión anterior (2026-07-13) fue resuelto en el código ni en la documentación —todos siguen abiertos y pasan a "Pendientes"—. El hallazgo nuevo más relevante es documental: el índice ([[App]]) y el log de la demo ("mesa dulce demo") todavía describen el modelo viejo de 3 tipos de producto (UNIDAD/VARIANTE/COMBO), mientras que [[Productos]], [[Variantes]] y ARCHITECTURE.md ya documentan el colapso a 2 tipos con atributos flexibles — riesgo real de que alguien se oriente con el doc equivocado. También aparecen dos brechas cruzadas entre dominios (`allowCartGuest` sin backing en el modelo de `Cart`, `showOutOfStock` no confirmado fuera del bot) y una ausencia notable para un e-commerce en producción: no hay recuperación de contraseña. La cobertura de TBD sigue igual de amplia (10 de 19 docs de servicio son stubs).

## Bugs y fixes sugeridos

- **[Media] Índice y log de demo desactualizados sobre el modelo de tipos de producto.** [[App]] describe `Productos` con "tipo explícito (UNIDAD/VARIANTE/COMBO)" y "mesa dulce demo" repite el mismo modelo de 3 tipos y variantes fijas color/size; el modelo real (ver [[Productos]], [[Variantes]], [[Carrito]], ARCHITECTURE §3) ya colapsó a 2 tipos (PRODUCTO/COMBO) con catálogo de atributos flexible por tenant. — App.md, mesa dulce demo.md
- **[Media] `TenantConfig.allowCartGuest` sin respaldo visible en el modelo.** El flag (default `true`) sugiere checkout de invitado, pero `Cart.userId` es `@unique` sin nullable (1 carrito por usuario logueado) y [[Carrito]] no documenta ningún camino de carrito anónimo/por sesión. O el flag es vestigial, o falta la feature detrás. — TenantConfig, Carrito
- **[Media] `showOutOfStock` solo confirmado en el bot, no en el storefront.** [[Chat de tienda]] documenta explícitamente que sus tools respetan `TenantConfig.showOutOfStock`; [[Productos]] no aclara si `GET /store/products` aplica el mismo filtro — riesgo de que el catálogo web muestre productos sin stock que el chatbot oculta. — Productos, Chat de tienda, TenantConfig
- **[Baja] `productVariantsEnabled` sin validación cruzada.** [[Productos]] lo marca como `[riesgo]`: un tenant con el flag en `false` puede igual recibir variantes extra por API — es puramente señal de UI para el panel admin. — Productos, TenantConfig
- **[Baja] Naming ambiguo en `GET /orders`.** Devuelve las órdenes del propio usuario, no las del tenant (el listado completo vive en `/orders/all`); fácil de malinterpretar para un consumidor nuevo de la API. — Órdenes

## Propuestas de features y mejoras

1. **[Alta] Recuperación de contraseña ("olvidé mi clave").** No existe ningún endpoint de reset — solo login/registro/verificación de email (ARCHITECTURE §6, `/auth`, `/store/auth`). Sin esto, cualquier cliente o admin que olvide su clave queda bloqueado; es una brecha operativa alta para producción.
2. **[Media] Cerrar el circuito de `PaymentStatus.REFUNDED`.** El enum lo contempla, pero [[MercadoPago]] sigue sin documentar (TBD) y no hay evidencia de que algún flujo lo setee. Antes de ir a producción con pagos reales conviene confirmar que existe un camino (webhook o manual) que mueva a `REFUNDED`.
3. **[Media] Sistema de cupones/descuentos.** Ausente en todo el vault (catálogo, carrito, órdenes). Es una feature estándar de e-commerce comparable, hoy no contemplada ni como propuesta.
4. **[Baja] Búsqueda de catálogo más allá de `name`.** [[Productos]] solo documenta filtro simple por nombre/categoría/atributos/precio — sin full-text ni tolerancia a errores de tipeo; afecta UX de descubrimiento en catálogos grandes.
5. **[Baja] Reviews/ratings de producto.** No existe en el modelo de datos ni en ningún doc de dominio; ayuda a conversión en storefronts B2C típicos.
6. **[Baja] Definir `allowCartGuest`: implementar o remover.** Ligado al bug de arriba — si el checkout de invitado no es un objetivo real, sacar el flag de [[TenantConfig]] para no prometer algo que el modelo no soporta.

## Pendientes de semanas anteriores

Del reporte de 2026-07-13 — ninguno fue resuelto en código ni en documentación; todos siguen aplicando tal cual:

- Sobreventa por concurrencia en stock (`OrderModel.updateOrderStatus` sobre snapshot pre-transacción). — [[Órdenes]], [[Combos]]
- Whitelist manual de `TenantConfig.update` (falla en silencio si se olvida un campo nuevo). — [[TenantConfig]]
- `GET /tenant-config/:tenantId` (admin) sin auth obligatoria (`attachUser`, no `verifyToken`). — [[TenantConfig]]
- `extraData` de `updateOrderStatus` sin validar por schema (canal de MercadoPago). — [[Órdenes]], [[MercadoPago]]
- Cost-guard de LLM no cubre `getToday` (push diario sin descontar cuota). — [[Sugerencias de contenido]]
- Ventana de ventas atada a `createdAt`, no a fecha de completado. — [[Sugerencias de contenido]]
- Cache de catálogo no se invalida al editar variantes (hasta 3 min de desfasaje). — [[Variantes]]
- `reviewOrder` no re-valida límites de combo al corregir cantidades. — [[Órdenes]], [[Combos]]
- Comentario desactualizado sobre el unique de sugerencias (dice 2 columnas, son 4). — [[Sugerencias de contenido]]
- Asimetría de auth admin/store (`verifyToken` solo cookie, no acepta Bearer). — ARCHITECTURE §11 / [[Auth y tokens]]
- Ruta de debug expuesta `GET /test/:id`.
- Columnas combo legacy sin limpiar (`Product.isCombo`, etc.). — [[Productos]]
- Sin scoping de tenant automático a nivel de Prisma (riesgo estructural). — [[Multi-tenancy]]
- Implementar "Sugerencias de contenido — Imágenes" (propuesta ya cerrada, solo falta construirla). — [[Sugerencias de contenido — Imágenes (propuesta)]]
- Cablear o quitar `SuggestionStatus` (enum sin transiciones). — [[Sugerencias de contenido]]
- Cola (BullMQ u otra) para el webhook de WhatsApp (hoy fire-and-forget in-process). — [[WhatsApp]]
- Soporte de combos en el bot de WhatsApp (diferido a propósito en v1). — [[Combos]], [[Chat de tienda]]
- Notificaciones proactivas por WhatsApp ante cambios de estado de pedido. — [[WhatsApp]], [[Mailer]]
- Endpoint de cantidad exacta en carrito. — [[Carrito]]
- Permitir que el cliente cancele su propia orden en `PENDING`. — [[Órdenes]]
- Adapter OpenAI-compat para el cliente LLM del chat (probar contra Ollama en dev). — [[Chat de tienda]], [[Cliente LLM]]
- `PATCH /products/:id/combo-options` incremental (hoy reemplaza toda la whitelist). — [[Combos]]
- Completar documentación TBD: sigue habiendo 10 stubs sin documentar ([[Multi-tenancy]], [[Auth y tokens]], [[Roles]], [[Usuarios y Auth]], [[MercadoPago]], [[Estadísticas]], [[Agente LLM]], [[Cliente LLM]], [[Crypto]], [[Mailer]], [[Rate limiting]], [[Redis y cache]], [[Almacenamiento de imágenes]] — más de los previstos la semana pasada).
