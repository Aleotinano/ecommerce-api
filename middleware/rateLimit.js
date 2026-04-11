import { rateLimit } from "express-rate-limit";

const rateLimitHandler = (req, res, _next, options) => {
  const resetTime = req.rateLimit?.resetTime;
  const retryAfterSeconds = resetTime
    ? Math.max(0, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
    : Math.ceil((options.windowMs ?? 0) / 1000);

  if (retryAfterSeconds > 0) {
    res.setHeader("Retry-After", String(retryAfterSeconds));
  }

  return res.status(options.statusCode ?? 429).json({
    error: {
      message:
        "Demasiadas solicitudes. Por favor intenta de nuevo más tarde.",
      code: "RATE_LIMIT_EXCEEDED",
      retryAfter: retryAfterSeconds,
      limit: req.rateLimit?.limit,
    },
  });
};

export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  limit: 100,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: (req) => req.path.startsWith("/auth"),
  handler: rateLimitHandler,
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: rateLimitHandler,
});

export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: rateLimitHandler,
});
