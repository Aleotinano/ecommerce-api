---
tags: [servicio, dominio/direcciones]
estado: estable
ultima-revision: 2026-07-27
lado: backend
---

# Direcciones (libreta del cliente)

> [!note] Implementado (backend)
> Modelo `UserAddress`, migración `20260727120000_add_user_address`, `schemas/address.schema.js`,
> `services/addresses.js`, `controllers/store/addresses.js`, `routes/store/addresses.js`. Tests en
> `tests/addresses.test.js` + dos casos cross-tenant en `tests/isolation.test.js`.

## Para qué existe

Un cliente que pide seguido no tiene por qué retipear su dirección en cada pedido. La libreta guarda
sus lugares con un nombre ("mi casa", "casa de mi mamá") y el checkout le deja elegir a cuál mandar.

## Lo que NO es

**No es la dirección de la orden.** `Order` sigue teniendo sus columnas planas (`addressText`,
`addressLat`, `addressLng`, `addressDetails`, `addressMapsUrl`) y ahí vive el snapshot histórico: lo
que el cliente pidió ese día, congelado. El checkout **copia** de la libreta a la orden.

Por eso `Order` **no tiene FK** a `UserAddress`, y por eso el borrado de una dirección es **físico**:
no hay forma de que borrar un lugar de la libreta altere un pedido ya cerrado. Sin soft-delete, no
hay nada que preservar referencialmente.

Consecuencia: `POST /store/orders` **no cambió**. Sigue recibiendo los campos planos y
`checkFulfillmentConsistency` sigue siendo el único validador. No se agregó un `addressId` como
atajo — forkearía `OrderModel.create` en dos ramas de verdad (copiar-de-la-fila vs
confiar-en-el-body) con ambigüedad cuando llegan ambos, todo para ahorrarle al front un spread.

## Endpoints

Todos bajo `/store/addresses`, con `verifyStoreToken` (no `optionalStoreAuth`: una dirección sin
`User` no tiene dueño ni forma de recuperarse — a diferencia del carrito, que sí tiene modo
invitado).

| Método | Ruta | Notas |
|---|---|---|
| GET | `/store/addresses` | `{ addresses: [...] }`, default primero |
| GET | `/store/addresses/:id` | |
| POST | `/store/addresses` | 201 |
| PATCH | `/store/addresses/:id` | también es cómo se marca la default |
| DELETE | `/store/addresses/:id` | |

**No hay ruta `/:id/default`.** `PATCH /:id { isDefault: true }` ya es una sola llamada, y el repo no
tiene sub-action routes en ningún CRUD.

## Reglas

- **Validación de ubicación idéntica al checkout.** `address.schema.js` importa `isGoogleMapsUrl` de
  `order.schema.js` — misma whitelist de hosts, mismos límites (text ≤300, mapsUrl ≤500, details
  ≤300). Hace falta `addressText` y/o `addressMapsUrl`; `lat`/`lng` van juntos o no van.
- **Tope de 10 direcciones** por usuario (`ADDRESS_LIMIT_REACHED`): es un endpoint de escritura sin
  otro límite y una libreta realista no pasa de un puñado de lugares.
- **La primera dirección queda default sola**, así el checkout siempre tiene algo preseleccionado.
- **Mover la default**: `PATCH { isDefault: true }`. El service limpia la default vieja **antes** de
  escribir la nueva — el índice único parcial se chequea por statement, el orden inverso choca con
  duplicate key.
- **Desmarcar la default a mano se respeta** (el índice parcial permite cero defaults), pero
  **borrar** la default **promueve** la más vieja restante: perderla al borrar es un efecto
  colateral, no una elección del cliente.
- **El PATCH valida la fila mergeada**, no el payload. Un PATCH que borra `addressText` sobre una
  fila sin `addressMapsUrl` devuelve `ADDRESS_LOCATION_REQUIRED` 400, en vez de dejar que el CHECK
  de la migración salga como 500.
- **Sin caché.** Es data por usuario, `/store/*` ya responde `no-store` y los namespaces de
  `delPattern` son solo de catálogo.

## Constraints que viven solo en la migración

Como `Cart_owner_xor_check` y el índice parcial de `ProductVariant.isDefault`: declararlos en
`schema.prisma` generaría drift en `migrate diff`.

- `UserAddress_user_default_key` — único parcial `ON ("userId") WHERE "isDefault" = true`.
- `UserAddress_location_present_check` — `addressText` y/o `addressMapsUrl`.
- `UserAddress_latlng_together_check` — lat y lng juntos o ninguno.

## Errores

| Code | Status | Cuándo |
|---|---|---|
| `ADDRESS_NOT_FOUND` | 404 | no existe, o no es del usuario/tenant |
| `ADDRESS_LABEL_DUPLICATE` | 409 | ya hay otra con ese nombre (P2002 sobre `UserAddress_userId_label_key`) |
| `ADDRESS_LIMIT_REACHED` | 409 | ya tiene 10 |
| `ADDRESS_LOCATION_REQUIRED` | 400 | el PATCH dejaría la fila sin ubicación |

## Gotcha de tests

`seedTenants()` (`tests/helpers.js`) borra `userAddress` **antes** que `user`: el `deleteMany` de
Prisma no dispara el `ON DELETE CASCADE` de la FK, y las filas huérfanas romperían el reseed de
**todos** los archivos de test, no solo el de direcciones.
