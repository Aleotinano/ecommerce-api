import { DEFAULTS } from "../config.js";
import { logger } from "../lib/logger.js";

export function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const code = err.code || "INTERNAL_ERROR";
  const isProd = DEFAULTS.NODE_ENV === "production";

  // Un 4xx es el cliente pidiendo mal, no el server fallando: loguearlo en
  // `error` iguala un 404 de una ruta inexistente con una caída de la base, y el
  // resultado es que el nivel `error` deja de significar nada. Los 5xx —lo único
  // que hay que salir a mirar— quedan solos en su nivel.
  const reqLog = req.log ?? logger;
  const isServerError = statusCode >= 500;
  const level = isServerError ? "error" : "warn";

  // El stack entra sólo en los 5xx. En un 404 de ruta inexistente son ocho
  // líneas siempre iguales (`notFoundHandler` y el router de Express): cero
  // información, ~1,5 KB por request. Con el hostname público bajo escaneo
  // automatizado constante ese ruido empuja los logs útiles fuera de la rotación
  // (`10m` × 3 en docker-compose.prod.yml). De los 4xx queda el mensaje y, si lo
  // hay, `details` —lo que arma zod en un 400 y dice qué campo falló—.
  // La clave sigue siendo `err`, que es donde se lee el mensaje: pino igual la
  // normaliza y al objeto plano le agrega `type: "Object"` y `stack: ""`, 25
  // bytes fijos contra las ocho líneas de antes.
  reqLog[level](
    {
      err: isServerError
        ? err
        : {
            message: err.message,
            ...(err.details !== undefined ? { details: err.details } : {}),
          },
      code,
      path: req.path,
      statusCode,
    },
    "request error"
  );

  const message =
    isProd && statusCode === 500 ? "Error interno del servidor" : err.message;

  res.status(statusCode).json({
    error: {
      message,
      code,
      ...(err.details !== undefined ? { details: err.details } : {}),
    },
  });
}

export function notFoundHandler(req, res, next) {
  const error = new Error("Ruta no encontrada");
  error.statusCode = 404;
  error.code = "NOT_FOUND";
  error.message = `ruta: ${req.originalUrl}`;
  next(error);
}
