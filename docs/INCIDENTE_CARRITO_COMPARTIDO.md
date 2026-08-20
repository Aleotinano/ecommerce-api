# Incidente: dos personas en el mismo carrito

**Fecha:** 2026-08-20 · **Tenant:** `pastaia` · **Estado:** resuelto — no era un bug

---

## Qué pasó

Una persona armaba su pedido y otra, que recién entraba a la tienda, veía sus productos y podía
sumar y quitar unidades. Cuando la primera confirmó la orden, el carrito quedó vacío para las dos.

## La causa

**Las dos estaban usando la misma cuenta.** La cuenta de `admin` se compartió con cuatro personas
más para testear, y en la base hay exactamente un usuario:

```
 id | username |         email          | role  | tenantId
  1 | admin    | ...                    | ADMIN |        1
```

`Cart.userId` es `@unique` **global** (`prisma/schema.prisma:555`): un usuario tiene **un solo
carrito en todo el sistema**, y ese carrito es además el que usa el mostrador del panel. Cinco
personas logueadas con la misma cuenta son, para el backend, una sola persona con un solo carrito.

Todo lo observado se sigue de ahí: los dos podían escribir porque era su carrito, y el checkout de
uno lo vació para el otro porque `OrderModel.create` vacía el carrito del dueño.

### La evidencia

Requests a `/store/*` como `userId: 1`, en 72 h: 406 desde una IPv6 pública y 195 desde la tailnet.
Cuatro IP distintas hicieron login en ese período. Y en las órdenes:

| # | userId | contacto |
|---|---|---|
| 4 | 1 | Alejandro |
| 3 | — | tu caca (invitado real) |
| 2 | 1 | **carlitox** |
| 1 | 1 | alejandro |

La orden 2 la creó otra persona, con otro teléfono, bajo `userId: 1`.

---

## Qué quedó descartado en el camino

El carrito de invitado **funciona bien** y no tuvo nada que ver:

- Los 3 carritos de invitado de la base tienen 3 `guestId` distintos, uno por visitante.
- Medido contra producción con dos cookie jars separados: cada uno recibe su propia identidad
  (`aecbc5bc-…` y `b2e2837a-…`), ve su propio carrito, y el segundo GET reusa su cookie sin
  re-emitirla.
- El scoping filtra siempre por `{ tenantId, guestId }` (`services/cart.js:10`) y `resolveCartOwner`
  nunca deja un guestId vacío (`middleware/guestCart.js:53`).

---

## Cómo testear sin repetirlo

**Los testers no tienen que loguearse en la tienda.** El storefront está pensado para comprar como
invitado (ver [[Producción sin cuentas]]): sin sesión, cada browser recibe su propia cookie
`guest_cart_id` y su propio carrito. El login es del panel, no de la tienda.

Si hace falta testear el flujo logueado, cada tester necesita **su propio usuario** — hoy
`POST /store/auth/register` existe pero el email está apagado, así que las altas se hacen por
consola en el server.

Y cuando el testeo termine: rotar la contraseña de `admin`, que hoy la tienen cinco personas.

---

## Deuda real que esto destapó

Dos cosas que no causaron el incidente pero que lo habrían causado igual, con clientes reales:

1. **El storefront acepta la cookie de sesión del panel como identidad de cliente.** `extractToken`
   cae a `req.cookies.access_token` si no hay Bearer (`middleware/auth.js:9`), y esa cookie es
   `SameSite=None; Path=/` sobre el mismo host de la API. Con el panel abierto en el mismo browser,
   navegar la tienda te loguea como admin sin querer — y te deja el carrito del mostrador delante.
   El storefront debería ser **sólo Bearer**.
2. **`POST /store/auth/login` no filtra por rol** (`controllers/store/auth.js:37`): un ADMIN o STAFF
   obtiene un Bearer de storefront válido. La superficie de tienda no debería aceptar cuentas de
   staff.

Y una que es de diseño, no bug: **`Cart.userId` es único global, sin `tenantId`**, así que el
carrito del mostrador y el del storefront son la misma fila. Mientras el mismo usuario no use las
dos superficies, no molesta.

---

## Instrumentación

`middleware/httpLogger.js` loguea `guest`, un hash de 8 hex del guestId (nunca el valor: es un
secreto portador, quien lo tiene se lleva el carrito). Sirve para verificar de un vistazo que cada
visitante tiene su propia identidad. Sacarlo cuando el testeo termine.

**Hueco de cobertura:** `tests/storefront.test.js:239` cubre los atributos de la cookie, pero ningún
test verifica que dos cookies de invitado distintas vean carritos distintos.
