import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import { getRedis } from "../lib/redis.js";
import { DEFAULTS } from "../config.js";
import { logger } from "../lib/logger.js";

const isProd = DEFAULTS.NODE_ENV === "production";

const createStore = (prefix = "rl:") => {
  try {
    const redis = getRedis();
    if (!redis) {
      logger.warn("redis unavailable, rate limiting will use in-memory store");
      return undefined;
    }

    return new RedisStore({
      sendCommand: async (...args) => redis.call(...args),
      prefix,
    });
  } catch (error) {
    logger.warn(
      { error: error.message },
      "failed to create redis store, using in-memory",
    );
    return undefined;
  }
};

const rateLimitHandler = (req, res, _next, options) => {
  const resetTime = req.rateLimit?.resetTime;
  const retryAfterSeconds = resetTime
    ? Math.max(0, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
    : Math.ceil((options.windowMs ?? 0) / 1000);

  if (retryAfterSeconds > 0) {
    res.setHeader("Retry-After", String(retryAfterSeconds));
  }

  const identifier = req.body?.email || req.ip;
  logger.warn(
    { identifier, endpoint: req.path, remaining: req.rateLimit?.remaining },
    "rate limit exceeded",
  );

  return res.status(options.statusCode ?? 429).json({
    error: {
      message: "Demasiadas solicitudes. Por favor intenta de nuevo más tarde.",
      code: "RATE_LIMIT_EXCEEDED",
      retryAfter: retryAfterSeconds,
    },
  });
};

let generalStore, loginStore, registerStore, webhookStore, chatStore;

try {
  generalStore = createStore("rl:general:");
} catch {
  generalStore = undefined;
}

try {
  loginStore = createStore("rl:login:");
} catch {
  loginStore = undefined;
}

try {
  registerStore = createStore("rl:register:");
} catch {
  registerStore = undefined;
}

try {
  webhookStore = createStore("rl:webhook:");
} catch {
  webhookStore = undefined;
}

try {
  chatStore = createStore("rl:chat:");
} catch {
  chatStore = undefined;
}

export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: (req) => !isProd,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  store: generalStore,
  handler: rateLimitHandler,
});

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skipFailedRequests: false,
  keyGenerator: (req) => req.body?.email || ipKeyGenerator(req.ip),
  store: loginStore,
  handler: rateLimitHandler,
  // Mismo motivo que en `registerLimiter`: los tests de credenciales inválidas
  // acumulan intentos fallidos en Redis y, a la segunda corrida seguida, un test
  // de auth empieza a recibir 429 donde espera 401.
  skip: () => DEFAULTS.NODE_ENV === "test",
});

export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  store: registerStore,
  handler: rateLimitHandler,
  // La suite completa registra más usuarios que el tope por hora, y el contador
  // vive en Redis: sin esto, correr los tests dos veces seguidas hace fallar
  // tests que no tienen nada que ver con rate limiting, y la única forma de
  // seguir era borrar la clave a mano. Ningún test cubre este limiter (los 429
  // que sí se testean son los cost-guard del LLM).
  skip: () => DEFAULTS.NODE_ENV === "test",
});

export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  store: webhookStore,
  handler: rateLimitHandler,
});

// Chatbot publico (POST /store/chat/message): rate limit por IP. Complementa el
// cost guard por tenant (services/chat/cost-guard.js): este frena ráfagas de una
// misma IP, aquel frena el consumo total de LLM por tienda.
export const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  store: chatStore,
  handler: rateLimitHandler,
});
