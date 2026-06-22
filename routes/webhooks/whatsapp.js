import { Router } from "express";
import express from "express";
import { WhatsappWebhookController } from "../../controllers/webhooks/whatsapp.js";

/**
 * Router del webhook de WhatsApp.
 *
 * El POST necesita el RAW body para validar la firma (X-Hub-Signature-256). Por
 * eso monta su PROPIO express.json con `verify`, que guarda el buffer crudo en
 * req.rawBody sin afectar el express.json global. Este router se monta ANTES del
 * parser global en app.js para que el body no se consuma antes.
 */
export const whatsappWebhookRouter = Router();

const jsonWithRawBody = express.json({
  limit: "256kb",
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
});

// GET: handshake de verificacion (sin body).
whatsappWebhookRouter.get("/", WhatsappWebhookController.verify);

// POST: recepcion de mensajes (necesita raw body para la firma).
whatsappWebhookRouter.post("/", jsonWithRawBody, WhatsappWebhookController.receive);
