import { Router } from "express";
import { cartController } from "../controllers/cart.js";
import { verifyToken } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { variantId } from "../schemas/variant.schema.js";

export const cartRouter = Router();

const validation = {
  variantId: validate({ params: variantId }),
};

cartRouter.get("/", verifyToken, cartController.getCart);

cartRouter.post(
  "/:variantId",
  verifyToken,
  validation.variantId,
  cartController.add
);

cartRouter.patch(
  "/:variantId",
  verifyToken,
  validation.variantId,
  cartController.remove
);

cartRouter.delete("/", verifyToken, cartController.clear);
