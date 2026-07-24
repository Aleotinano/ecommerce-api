import "dotenv/config";

import express from "express";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";

import { DEFAULTS } from "./config.js";
import { logger } from "./lib/logger.js";
import { httpLogger } from "./middleware/httpLogger.js";

// rutas
import { ordersRouter } from "./routes/orders.js";
import { productosRouter } from "./routes/productos.js";
import { variantRouter } from "./routes/variants.js";
import { roleRouter } from "./routes/role.js";
import { usersRouter } from "./routes/users.js";
import { testRouter } from "./routes/test.js";
import { cartRouter } from "./routes/cart.js";
import { categoriesRouter } from "./routes/categories.js";
import { promosRouter } from "./routes/promos.js";
import { mercadopagoRouter } from "./routes/mercadopago.js";
import { statsRouter } from "./routes/stats.js";
import { contentSuggestionsRouter } from "./routes/content-suggestions.js";
import { pageSpecRouter } from "./routes/page-spec.js";
import { storeRouter } from "./routes/store/index.js";
import { whatsappWebhookRouter } from "./routes/webhooks/whatsapp.js";

// Middlewares
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { middleWare } from "./middleware/cors.js";
import { generalLimiter } from "./middleware/rateLimit.js";
import { tenantConfigRouter } from "./routes/tenant-config.js";
import { tenantAttributesRouter } from "./routes/tenant-attributes.js";

const PORT = DEFAULTS.PORT || 3001;
const app = express();

app.use(helmet());
app.use(middleWare());

// Webhook de WhatsApp: montado ANTES del express.json global porque valida la
// firma sobre el RAW body (el router parsea con su propio verify -> req.rawBody).
app.use("/webhooks/whatsapp", whatsappWebhookRouter);

app.use(express.json({ limit: "10kb" }));
app.use(cookieParser());
app.use(compression());
app.use(httpLogger);

app.use(generalLimiter);

app.use("/orders", ordersRouter);
app.use("/products", productosRouter);
app.use("/variants", variantRouter);
app.use("/categories", categoriesRouter);
app.use("/promos", promosRouter);
app.use("/cart", cartRouter);
app.use("/users", roleRouter);
app.use("/mercadopago", mercadopagoRouter);
app.use("/stats", statsRouter);
app.use("/content-suggestions", contentSuggestionsRouter);
app.use("/page-spec", pageSpecRouter);
app.use("/auth", usersRouter);
app.use("/test", testRouter);
app.use("/tenant-config", tenantConfigRouter);
app.use("/tenant-attributes", tenantAttributesRouter);
app.use("/store", storeRouter);

// Manejo de errores \\
app.use(notFoundHandler);
app.use(errorHandler);

export { app };

if (DEFAULTS.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    logger.info({ port: PORT }, "server listening");
  });
}
