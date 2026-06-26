import { Router } from "express";
import { StorePageController } from "../../controllers/store/page.js";

export const storePageRouter = Router();

// El tenant ya lo resolvió resolveTenantFromSlug (montado en store/index.js).
storePageRouter.get("/", StorePageController.get);
