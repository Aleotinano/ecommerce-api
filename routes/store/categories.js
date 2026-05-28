import { Router } from "express";
import { StoreCategoriesController } from "../../controllers/store/categories.js";
import { validate } from "../../middleware/validate.js";
import { validateId } from "../../schemas/id.schema.js";
import { optionalStoreAuth } from "../../middleware/auth.js";

export const storeCategoriesRouter = Router();

const validation = {
  id: validate({ params: validateId }),
};

storeCategoriesRouter.get(
  "/",
  optionalStoreAuth,
  StoreCategoriesController.getAll
);

storeCategoriesRouter.get(
  "/tree",
  optionalStoreAuth,
  StoreCategoriesController.getTree
);

storeCategoriesRouter.get(
  "/:id",
  optionalStoreAuth,
  validation.id,
  StoreCategoriesController.getById
);
