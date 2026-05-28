import { Router } from "express";
import { mercadopagoController } from "../../controllers/mercadopago.js";
import { validate } from "../../middleware/validate.js";
import { validateId } from "../../schemas/id.schema.js";
import { verifyStoreToken } from "../../middleware/auth.js";

export const storeMercadopagoRouter = Router();

storeMercadopagoRouter.post(
  "/:id",
  verifyStoreToken,
  validate({ params: validateId }),
  mercadopagoController.create
);
