import { Router } from "express";
import { OrderController } from "../../controllers/orders.js";
import { validate } from "../../middleware/validate.js";
import { validateId } from "../../schemas/id.schema.js";
import { orderQuery, orderCreate } from "../../schemas/order.schema.js";
import { optionalStoreAuth, verifyStoreToken } from "../../middleware/auth.js";
import { resolveCartOwner } from "../../middleware/guestCart.js";
import { createError } from "../../helpers/error.js";

export const storeOrdersRouter = Router();

// OrderController.create es compartido con la ruta admin (routes/orders.js), que
// crea órdenes ya validadas por un humano. Las que entran por acá las carga el
// cliente: quedan como STORE y no pasan a producción sin review (ver el guard
// ORDER_NOT_REVIEWED en services/orders.js).
function markStoreOrigin(req, _res, next) {
  req.orderOrigin = "STORE";
  next();
}

// El schema `orderCreate` es compartido con la ruta de admin y por eso ACEPTA
// `items`, pero acá no significan nada: el pedido de un cliente sale del carrito,
// que es lo único que pasó por las validaciones de `cart.add`.
//
// Se rechaza en vez de ignorarse. El controller igual los descarta por origin,
// pero un 201 que tiró a la basura media petición es indistinguible de uno que
// hizo lo que le pidieron: quien mande items se va a enterar cuando la orden no
// tenga lo que mandó, lejos de la línea que lo causó.
function rejectExplicitItems(req, _res, next) {
  if (req.body?.items !== undefined) {
    return next(
      createError(
        "Esta ruta no acepta items: el pedido sale del carrito",
        "ITEMS_NOT_ALLOWED",
        400
      )
    );
  }
  next();
}

// Confirmar el pedido NO exige cuenta, igual que el carrito (routes/store/cart.js):
// `optionalStoreAuth` deja pasar con o sin token y `resolveCartOwner` resuelve el
// dueño como { userId } o { guestId } de la cookie httpOnly. El invitado, a cambio,
// tiene que dar nombre y teléfono sí o sí — sin cuenta no hay otra forma de
// contactarlo (ver OrderModel.create).
//
// `rejectExplicitItems` va primero de todo: si el pedido se va a rechazar, que no
// emita antes la cookie de invitado ni resuelva un carrito. Y va antes de
// `validate` porque "acá no van items" es mejor diagnóstico que "tu items está
// mal formado".
storeOrdersRouter.post(
  "/",
  rejectExplicitItems,
  optionalStoreAuth,
  resolveCartOwner,
  markStoreOrigin,
  validate({ body: orderCreate }),
  OrderController.create
);

// El historial sí sigue siendo de la cuenta: un invitado no tiene con qué probar
// que una orden es suya. Lo que ve al confirmar sale de la respuesta del POST.
storeOrdersRouter.get(
  "/",
  verifyStoreToken,
  validate({ query: orderQuery }),
  OrderController.getAll
);
storeOrdersRouter.get(
  "/:id",
  verifyStoreToken,
  validate({ params: validateId }),
  OrderController.getById
);
