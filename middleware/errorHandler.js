import { DEFAULTS } from "../config.js";
import { logger } from "../lib/logger.js";

export function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const code = err.code || "INTERNAL_ERROR";
  const isProd = DEFAULTS.NODE_ENV === "production";

  const reqLog = req.log ?? logger;
  reqLog.error(
    {
      err,
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
