import { Router } from "express";
import { mercadopagoController } from "../controllers/mercadopago.js";
import { verifyToken } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { webhookLimiter } from "../middleware/rateLimit.js";
import { validateId } from "../schemas/id.schema.js";

export const mercadopagoRouter = Router();

const validation = {
  id: validate({ params: validateId }),
};

mercadopagoRouter.get("/success", (req, res) => {
  console.log("[MP][back_url][success]", req.query);
  return res.status(200).send("Pago aprobado. Ya podes volver a la app.");
});

mercadopagoRouter.get("/failure", (req, res) => {
  console.log("[MP][back_url][failure]", req.query);
  return res.status(200).send("Pago rechazado o cancelado.");
});

mercadopagoRouter.get("/pending", (req, res) => {
  console.log("[MP][back_url][pending]", req.query);
  return res.status(200).send("Pago pendiente.");
});

mercadopagoRouter.post("/webhook", webhookLimiter, mercadopagoController.getWebhook);

mercadopagoRouter.post(
  "/:id",
  verifyToken,
  validation.id,
  mercadopagoController.create
);
