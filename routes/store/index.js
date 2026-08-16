import { Router } from "express";
import { resolveTenantFromSlug } from "../../middleware/tenant.js";
import { storeCors } from "../../middleware/cors.js";
import { ssrReadLimiter } from "../../middleware/rateLimit.js";
import { storeCacheHeaders } from "../../middleware/storeCache.js";
import { storeAuthRouter } from "./auth.js";
import { storeProductsRouter } from "./products.js";
import { storeCategoriesRouter } from "./categories.js";
import { storeCartRouter } from "./cart.js";
import { storeOrdersRouter } from "./orders.js";
import { storeAddressesRouter } from "./addresses.js";
import { storeConfigRouter } from "./config.js";
import { storeMercadopagoRouter } from "./mercadopago.js";
import { storeChatRouter } from "./chat.js";
import { storePageRouter } from "./page.js";

export const storeRouter = Router();

storeRouter.use(storeCors());
storeRouter.use(storeCacheHeaders);
storeRouter.use(resolveTenantFromSlug);

storeRouter.use("/auth", storeAuthRouter);
storeRouter.use("/products", storeProductsRouter);
storeRouter.use("/categories", storeCategoriesRouter);
storeRouter.use("/cart", storeCartRouter);
storeRouter.use("/orders", storeOrdersRouter);
storeRouter.use("/addresses", storeAddressesRouter);
// `/config` y `/page` las pide el SERVIDOR de Vercel en cada render de la home, no
// el browser: llegan todas con la misma IP de egreso. Van a un limiter con clave
// por tenant y salteadas del general, que las metería a todas en un solo balde.
// Ver middleware/rateLimit.js -> SSR_PATHS.
storeRouter.use("/config", ssrReadLimiter, storeConfigRouter);
storeRouter.use("/page", ssrReadLimiter, storePageRouter);
storeRouter.use("/mercadopago", storeMercadopagoRouter);
storeRouter.use("/chat", storeChatRouter);
