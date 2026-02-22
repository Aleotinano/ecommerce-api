import "dotenv/config";

import express from "express";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import cookieParser from "cookie-parser";

import { DEFAULTS } from "./config.js";

// rutas
import { ordersRouter } from "./routes/orders.js";
import { productosRouter } from "./routes/productos.js";
import { roleRouter } from "./routes/role.js";
import { usersRouter } from "./routes/users.js";
import { testRouter } from "./routes/test.js";
import { cartRouter } from "./routes/cart.js";
import { categoriesRouter } from "./routes/categories.js";
import { mercadopagoRouter } from "./routes/mercadopago.js";

// Middlewares
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { middleWare } from "./middleware/cors.js";

const PORT = DEFAULTS.PORT || 3001;
const app = express();

app.use(express.json());
app.use(cookieParser());
app.use(middleWare());
app.use(helmet());
app.use(compression());
app.use(morgan("tiny"));

app.use("/orders", ordersRouter);
app.use("/products", productosRouter);
app.use("/categories", categoriesRouter);
app.use("/cart", cartRouter);
app.use("/users", roleRouter);
app.use("/mercadopago", mercadopagoRouter);
app.use("/auth", usersRouter);
app.use("/test", testRouter);

// Manejo de errores \\
app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`puerto levantado en ${PORT}`);
});
