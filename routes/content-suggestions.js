import { Router } from "express";
import { ContentSuggestionController } from "../controllers/content-suggestions.js";
import { verifyToken } from "../middleware/auth.js";
import { requireRole } from "../middleware/role.js";
import { validate } from "../middleware/validate.js";
import {
  suggestionRangeQuery,
  productIdParam,
  generateBody,
  refineBody,
} from "../schemas/content-suggestion.schema.js";

export const contentSuggestionsRouter = Router();

const roleRequired = ["ADMIN", "STAFF"];

// Timeline: rango completo de dias (range=7|15|30, default 7)
contentSuggestionsRouter.get(
  "/",
  verifyToken,
  requireRole(roleRequired),
  validate({ query: suggestionRangeQuery }),
  ContentSuggestionController.getRange
);

// Sugerencia de contenido del dia (se crea on-demand si no existe)
contentSuggestionsRouter.get(
  "/today",
  verifyToken,
  requireRole(roleRequired),
  ContentSuggestionController.getToday
);

// Tab de producto: angulos que aplican a un producto puntual
contentSuggestionsRouter.get(
  "/products/:productId/angles",
  verifyToken,
  requireRole(roleRequired),
  validate({ params: productIdParam }),
  ContentSuggestionController.getProductAngles
);

// Tab de producto: genera (o sirve cacheado) el copy de un producto + angulo
contentSuggestionsRouter.post(
  "/products/:productId/generate",
  verifyToken,
  requireRole(roleRequired),
  validate({ params: productIdParam, body: generateBody }),
  ContentSuggestionController.generateForProduct
);

// Tab de producto: variacion efimera de un copy ya generado
contentSuggestionsRouter.post(
  "/refine",
  verifyToken,
  requireRole(roleRequired),
  validate({ body: refineBody }),
  ContentSuggestionController.refineProductCopy
);
