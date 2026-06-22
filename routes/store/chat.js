import { Router } from "express";
import { ChatController } from "../../controllers/store/chat.js";
import { validate } from "../../middleware/validate.js";
import { optionalStoreAuth } from "../../middleware/auth.js";
import { chatLimiter } from "../../middleware/rateLimit.js";
import { chatMessageBody } from "../../schemas/chat.schema.js";

export const storeChatRouter = Router();

// chatLimiter: rate limit por IP (complementa el cost guard por tenant en Redis).
// optionalStoreAuth: el bot funciona anonimo; si hay Bearer valido, trae el user.
// El tenant ya viene resuelto por slug (resolveTenantFromSlug del router padre).
storeChatRouter.post(
  "/message",
  chatLimiter,
  optionalStoreAuth,
  validate({ body: chatMessageBody }),
  ChatController.sendMessage
);
