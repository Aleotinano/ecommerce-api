import { Router } from "express";
import { cartController } from "../controllers/cart.js";
import { verifyToken } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { productId } from "../schemas/product.schema.js";

export const cartRouter = Router();

const validation = {
  productId: validate({ params: productId }),
};

cartRouter.get("/", verifyToken, cartController.getCart);

cartRouter.post(
  "/:productId",
  verifyToken,
  validation.productId,
  cartController.add
);

cartRouter.patch(
  "/:productId",
  verifyToken,
  validation.productId,
  cartController.remove
);

cartRouter.delete("/", verifyToken, cartController.clear);
