---
tags: [servicio, dominio/usuarios]
estado: TBD
ultima-revision: 2026-07-29
lado: backend
---

# Usuarios y Auth

> [!important] Decisión de producto: en producción NO se usa (2026-07-29)
> El código de registro/login existe y funciona, pero **el primer cliente en producción
> ([[mesa dulce demo|Mesa Dulce]]) opera sin cuentas**, en los dos lados:
>
> **Clientes de la tienda → todo invitado.** Login y registro se interponen entre el cliente y la
> compra: cada paso extra antes de confirmar es una oportunidad de abandonar el pedido. El camino
> real es el de invitado, que ya está implementado punta a punta ([[Carrito]] con cookie `guestId`,
> checkout sin sesión en `/store/orders`) y que a cambio **exige nombre y teléfono** — sin cuenta,
> ese es el único dato de contacto que queda.
>
> **Administradores → credenciales entregadas a mano.** Las cuentas del backoffice las crea y las
> entrega el dueño del producto, una por una. Son pocos usuarios y no hay autoservicio: no se busca
> que un cliente se registre solo.
>
> **Qué implica para quien toca este módulo:** no se puede asumir que una orden tiene `userId`, ni
> que el cliente puede volver a ver su historial, ni que hay email al que escribirle. Todo lo que
> dependa de una cuenta es opcional por diseño, no un caso borde. El plan de integración —qué se
> apaga, qué queda como estaba, cómo se entregan las credenciales y qué pasa con los avisos al
> invitado— está en [[Producción sin cuentas (propuesta)]].

> [!todo] Pendiente de documentar
> Stub generado en Fase 3. Fuentes a leer: `services/users.js`, `controllers/users.js`,
> `controllers/store/auth.js`, `routes/users.js`, `routes/store/auth.js`, `schemas/auth.schema.js`,
> `schemas/store-auth.schema.js`. Capturar: registro/login, verificación de email
> (`emailVerificationTokenHash`), y los **dos** esquemas de token (`verifyToken` vs `verifyStoreToken`).
> Relación con [[Auth y tokens]] y [[Roles]]. `estado: TBD` (ver convención en [[App]]).

## Propósito
> [!todo] Pendiente de documentar

## Modelo de datos
> [!todo] Pendiente de documentar

## Reglas de negocio / invariantes
> [!todo] Pendiente de documentar

## Máquina de estados (si aplica)
> [!todo] Pendiente de documentar

## Endpoints
> [!todo] Pendiente de documentar

## Dependencias
> [!todo] Pendiente de documentar

## Integraciones externas
> [!todo] Pendiente de documentar

## Deuda técnica / cosas raras
> [!todo] Pendiente de documentar

## Preguntas abiertas / mejoras candidatas
> [!todo] Pendiente de documentar
