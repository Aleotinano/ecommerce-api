import { Router } from "express";
import { cartController } from "../../controllers/cart.js";
import { verifyStoreToken } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { variantId } from "../../schemas/variant.schema.js";

export const storeCartRouter = Router();

const validateVariantId = validate({ params: variantId });

storeCartRouter.use(verifyStoreToken);

storeCartRouter.get("/", cartController.getCart);
storeCartRouter.post("/:variantId", validateVariantId, cartController.add);
storeCartRouter.patch("/:variantId", validateVariantId, cartController.remove);
storeCartRouter.delete("/", cartController.clear);
