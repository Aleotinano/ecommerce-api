import { Router } from "express";
import { PageSpecController } from "../controllers/page-spec.js";
import { verifyToken } from "../middleware/auth.js";
import { requireRole } from "../middleware/role.js";
import { validate } from "../middleware/validate.js";
import { pageSpecDraftBody } from "../schemas/page-spec.schema.js";

export const pageSpecRouter = Router();

const roleRequired = ["ADMIN"];

// Borrador actual del tenant
pageSpecRouter.get(
  "/",
  verifyToken,
  requireRole(roleRequired),
  PageSpecController.getDraft
);

// Guardar/actualizar el borrador (no publica)
pageSpecRouter.put(
  "/draft",
  verifyToken,
  requireRole(roleRequired),
  validate({ body: pageSpecDraftBody }),
  PageSpecController.saveDraft
);

// Publicar: promueve el borrador a publicado (acción humana)
pageSpecRouter.post(
  "/publish",
  verifyToken,
  requireRole(roleRequired),
  PageSpecController.publish
);
