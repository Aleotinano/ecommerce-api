import "dotenv/config";

import express from "express";
import cookieParser from "cookie-parser";

import { DEFAULTS } from "./config.js";

// rutas
import { productosRouter } from "./routes/productos.js";
import { roleRouter } from "./routes/role.js";
import { usersRouter } from "./routes/users.js";
import { testRouter } from "./routes/test.js";
import { cartRouter } from "./routes/cart.js";

// Middlewares
import { middleWare } from "./middleware/cors.js";

const PORT = DEFAULTS.PORT || 3001;
const app = express();

app.use(express.json());
app.use(cookieParser());
app.use(middleWare());

app.use("/products", productosRouter);
app.use("/cart", cartRouter);
app.use("/users", roleRouter);
app.use("/auth", usersRouter);
app.use("/test", testRouter);

app.use((req, res) => {
  res.status(404).json({
    message: "Ruta no encontrada",
    path: req.path,
  });
});

app.listen(PORT, () => {
  console.log(`puerto levantado en ${PORT}`);
});
