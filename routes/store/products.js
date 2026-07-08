import { Router } from "express";
import { StoreProductsController } from "../../controllers/store/products.js";
import { validate } from "../../middleware/validate.js";
import { productQuery } from "../../schemas/product.schema.js";
import { validateId } from "../../schemas/id.schema.js";
import { optionalStoreAuth } from "../../middleware/auth.js";

export const storeProductsRouter = Router();

const validation = {
  query: validate({ query: productQuery }),
  id: validate({ params: validateId }),
};

storeProductsRouter.get(
  "/",
  optionalStoreAuth,
  validation.query,
  StoreProductsController.getAll
);

storeProductsRouter.get(
  "/options",
  optionalStoreAuth,
  StoreProductsController.getVariantOptions
);

storeProductsRouter.get(
  "/:id",
  optionalStoreAuth,
  validation.id,
  StoreProductsController.getById
);

storeProductsRouter.get(
  "/:id/combo-options",
  optionalStoreAuth,
  validation.id,
  StoreProductsController.getComboOptions
);
