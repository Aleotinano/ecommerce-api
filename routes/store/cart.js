import { Router } from "express";
import { cartController } from "../../controllers/cart.js";
import { verifyStoreToken } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { productIdParam } from "../../schemas/product.schema.js";
import { cartItemBody } from "../../schemas/cart.schema.js";
import { comboSelectionBody } from "../../schemas/combo.schema.js";

export const storeCartRouter = Router();

const validateItem = validate({ params: productIdParam, body: cartItemBody });
const validateComboBody = validate({ params: productIdParam, body: comboSelectionBody });

storeCartRouter.use(verifyStoreToken);

storeCartRouter.get("/", cartController.getCart);
storeCartRouter.post("/combo/:productId", validateComboBody, cartController.addCombo);
storeCartRouter.post("/:productId", validateItem, cartController.add);
storeCartRouter.patch("/:productId", validateItem, cartController.remove);
storeCartRouter.delete("/", cartController.clear);
