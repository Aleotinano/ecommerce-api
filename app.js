import "dotenv/config";

import express from "express";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";

import { DEFAULTS } from "./config.js";

// rutas
import { ordersRouter } from "./routes/orders.js";
import { productosRouter } from "./routes/productos.js";
import { variantRouter } from "./routes/variants.js";
import { roleRouter } from "./routes/role.js";
import { usersRouter } from "./routes/users.js";
import { testRouter } from "./routes/test.js";
import { cartRouter } from "./routes/cart.js";
import { categoriesRouter } from "./routes/categories.js";
import { mercadopagoRouter } from "./routes/mercadopago.js";
import { statsRouter } from "./routes/stats.js";

// Middlewares
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { middleWare } from "./middleware/cors.js";

const PORT = DEFAULTS.PORT || 3001;
const isProd = DEFAULTS.NODE_ENV === "production";
const app = express();

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  limit: 100,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

app.use(helmet());
app.use(middleWare());
app.use(express.json({ limit: "10kb" }));
app.use(cookieParser());
app.use(compression());
app.use(morgan(isProd ? "combined" : "dev"));

app.use(generalLimiter);

app.use("/orders", ordersRouter);
app.use("/products/", productosRouter);
app.use("/variants", variantRouter);
app.use("/categories", categoriesRouter);
app.use("/cart", cartRouter);
app.use("/users", roleRouter);
app.use("/mercadopago", mercadopagoRouter);
app.use("/stats", statsRouter);
app.use("/auth", authLimiter, usersRouter);
app.use("/test", testRouter);

// Manejo de errores \\
app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`puerto levantado en ${PORT}`);
});
