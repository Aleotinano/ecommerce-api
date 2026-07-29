import { Router } from "express";
import { OrderController } from "../../controllers/orders.js";
import { validate } from "../../middleware/validate.js";
import { validateId } from "../../schemas/id.schema.js";
import { orderQuery, orderCreate } from "../../schemas/order.schema.js";
import { optionalStoreAuth, verifyStoreToken } from "../../middleware/auth.js";
import { resolveCartOwner } from "../../middleware/guestCart.js";

export const storeOrdersRouter = Router();

// OrderController.create es compartido con la ruta admin (routes/orders.js), que
// crea órdenes ya validadas por un humano. Las que entran por acá las carga el
// cliente: quedan como STORE y no pasan a producción sin review (ver el guard
// ORDER_NOT_REVIEWED en services/orders.js).
function markStoreOrigin(req, _res, next) {
  req.orderOrigin = "STORE";
  next();
}

// Confirmar el pedido NO exige cuenta, igual que el carrito (routes/store/cart.js):
// `optionalStoreAuth` deja pasar con o sin token y `resolveCartOwner` resuelve el
// dueño como { userId } o { guestId } de la cookie httpOnly. El invitado, a cambio,
// tiene que dar nombre y teléfono sí o sí — sin cuenta no hay otra forma de
// contactarlo (ver OrderModel.create).
storeOrdersRouter.post(
  "/",
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
