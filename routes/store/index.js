import { Router } from "express";
import { resolveTenantFromSlug } from "../../middleware/tenant.js";
import { storeCors } from "../../middleware/cors.js";
import { storeAuthRouter } from "./auth.js";
import { storeProductsRouter } from "./products.js";
import { storeCategoriesRouter } from "./categories.js";
import { storeCartRouter } from "./cart.js";
import { storeOrdersRouter } from "./orders.js";
import { storeConfigRouter } from "./config.js";
import { storeMercadopagoRouter } from "./mercadopago.js";
import { storeChatRouter } from "./chat.js";
import { storePageRouter } from "./page.js";

export const storeRouter = Router();

storeRouter.use(storeCors());
storeRouter.use(resolveTenantFromSlug);

storeRouter.use("/auth", storeAuthRouter);
storeRouter.use("/products", storeProductsRouter);
storeRouter.use("/categories", storeCategoriesRouter);
storeRouter.use("/cart", storeCartRouter);
storeRouter.use("/orders", storeOrdersRouter);
storeRouter.use("/config", storeConfigRouter);
storeRouter.use("/page", storePageRouter);
storeRouter.use("/mercadopago", storeMercadopagoRouter);
storeRouter.use("/chat", storeChatRouter);
