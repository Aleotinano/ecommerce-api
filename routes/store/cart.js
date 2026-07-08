import { Router } from "express";
import { cartController } from "../../controllers/cart.js";
import { verifyStoreToken } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { variantId } from "../../schemas/variant.schema.js";
import { comboSelectionBody } from "../../schemas/combo.schema.js";

export const storeCartRouter = Router();

const validateVariantId = validate({ params: variantId });
const validateComboBody = validate({ params: variantId, body: comboSelectionBody });

storeCartRouter.use(verifyStoreToken);

storeCartRouter.get("/", cartController.getCart);
storeCartRouter.post("/combo/:variantId", validateComboBody, cartController.addCombo);
storeCartRouter.post("/:variantId", validateVariantId, cartController.add);
storeCartRouter.patch("/:variantId", validateVariantId, cartController.remove);
storeCartRouter.delete("/", cartController.clear);
