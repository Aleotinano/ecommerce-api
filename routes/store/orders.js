import { Router } from "express";
import { OrderController } from "../../controllers/orders.js";
import { validate } from "../../middleware/validate.js";
import { validateId } from "../../schemas/id.schema.js";
import { orderQuery, orderCreate } from "../../schemas/order.schema.js";
import { verifyStoreToken } from "../../middleware/auth.js";

export const storeOrdersRouter = Router();

storeOrdersRouter.use(verifyStoreToken);

// OrderController.create es compartido con la ruta admin (routes/orders.js), que
// crea órdenes ya validadas por un humano. Las que entran por acá las carga el
// cliente: quedan como STORE y no pasan a producción sin review (ver el guard
// ORDER_NOT_REVIEWED en services/orders.js).
function markStoreOrigin(req, _res, next) {
  req.orderOrigin = "STORE";
  next();
}

storeOrdersRouter.post(
  "/",
  markStoreOrigin,
  validate({ body: orderCreate }),
  OrderController.create
);
storeOrdersRouter.get("/", validate({ query: orderQuery }), OrderController.getAll);
storeOrdersRouter.get(
  "/:id",
  validate({ params: validateId }),
  OrderController.getById
);
