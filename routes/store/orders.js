import { Router } from "express";
import { OrderController } from "../../controllers/orders.js";
import { validate } from "../../middleware/validate.js";
import { validateId } from "../../schemas/id.schema.js";
import { verifyStoreToken } from "../../middleware/auth.js";

export const storeOrdersRouter = Router();

storeOrdersRouter.use(verifyStoreToken);

storeOrdersRouter.post("/", OrderController.create);
storeOrdersRouter.get("/", OrderController.getAll);
storeOrdersRouter.get(
  "/:id",
  validate({ params: validateId }),
  OrderController.getById
);
