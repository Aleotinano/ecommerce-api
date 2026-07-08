import { Router } from "express";
import { cartController } from "../controllers/cart.js";
import { verifyToken } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { productIdParam } from "../schemas/product.schema.js";
import { cartItemBody } from "../schemas/cart.schema.js";
import { comboSelectionBody } from "../schemas/combo.schema.js";

export const cartRouter = Router();

const validation = {
  item: validate({ params: productIdParam, body: cartItemBody }),
  comboBody: validate({ params: productIdParam, body: comboSelectionBody }),
};

cartRouter.get("/", verifyToken, cartController.getCart);

cartRouter.post(
  "/combo/:productId",
  verifyToken,
  validation.comboBody,
  cartController.addCombo
);

cartRouter.post(
  "/:productId",
  verifyToken,
  validation.item,
  cartController.add
);

cartRouter.patch(
  "/:productId",
  verifyToken,
  validation.item,
  cartController.remove
);

cartRouter.delete("/", verifyToken, cartController.clear);
