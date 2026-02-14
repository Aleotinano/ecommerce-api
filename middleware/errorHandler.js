import { DEFAULTS } from "../config.js";

export function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const code = err.code || "INTERNAL_ERROR";
  const isProd = DEFAULTS.NODE_ENV === "production";

  console.error("Error:", {
    message: err.message,
    code: code,
    path: req.path,
    stack: err.stack,
  });

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
  const { path } = req.originalUrl;

  error.statusCode = 404;
  error.code = "NOT_FOUND";
  error.message = `ruta: ${path} `;
  next(error);
}
