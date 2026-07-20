import { Router } from "express";
import { cartController } from "../../controllers/cart.js";
import { optionalStoreAuth } from "../../middleware/auth.js";
import { resolveCartOwner } from "../../middleware/guestCart.js";
import { validate } from "../../middleware/validate.js";
import { productIdParam } from "../../schemas/product.schema.js";
import { cartItemBody } from "../../schemas/cart.schema.js";
import { comboSelectionBody } from "../../schemas/combo.schema.js";

export const storeCartRouter = Router();

const validateItem = validate({ params: productIdParam, body: cartItemBody });
const validateComboBody = validate({ params: productIdParam, body: comboSelectionBody });

// Carrito accesible sin login: optionalStoreAuth deja pasar con o sin token
// (req.user null si no hay/ es inválido), resolveCartOwner resuelve el dueño del
// carrito como { userId } si está logueado o { guestId } (cookie httpOnly) si no.
storeCartRouter.use(optionalStoreAuth, resolveCartOwner);

storeCartRouter.get("/", cartController.getCart);
storeCartRouter.post("/combo/:productId", validateComboBody, cartController.addCombo);
storeCartRouter.post("/:productId", validateItem, cartController.add);
storeCartRouter.patch("/:productId", validateItem, cartController.remove);
storeCartRouter.delete("/", cartController.clear);
