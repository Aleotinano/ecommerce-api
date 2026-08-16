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

/**
 * Las tres rutas que el frontend pide desde el SERVIDOR de Vercel (SSR), no desde
 * el browser del visitante: `/store/config` y `/store/page` en cada render de la
 * home, y `/order-statuses` para pintar el estado de un pedido.
 *
 * Todas llegan con la IP de egreso de Vercel, la misma para TODOS los visitantes
 * de TODAS las tiendas. Con la clave por IP del `generalLimiter` eso es un solo
 * balde de 200 req / 15 min: a dos requests por render, se agota a los ~13 renders
 * por minuto y el 429 cae sobre el SSR de la tienda entera a la vez. Por eso se
 * saltean el limiter general y van al suyo, con la clave por tenant.
 *
 * Se compara contra `req.path` sin barra final: el middleware global corre antes
 * que cualquier router, así que ve el path completo.
 */
const SSR_PATHS = new Set(["/order-statuses", "/store/config", "/store/page"]);

const isSsrReadPath = (req) =>
  SSR_PATHS.has(req.path.length > 1 ? req.path.replace(/\/+$/, "") : req.path);

let generalStore, loginStore, registerStore, webhookStore, chatStore, ssrStore;

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

try {
  ssrStore = createStore("rl:ssr:");
} catch {
  ssrStore = undefined;
}

export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: (req) => !isProd || isSsrReadPath(req),
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  store: generalStore,
  handler: rateLimitHandler,
});

/**
 * Las tres lecturas que hace el SSR (ver `SSR_PATHS`). La clave es
 * `<tenant>:<ip>`, no la IP sola:
 *
 * - Desde el SSR el slug es fijo por tienda y la IP es la de Vercel, así que cada
 *   tenant tiene su propio balde y ninguno puede tirar abajo el render de otro.
 * - Desde un browser que le pegue directo, la IP es la del visitante, así que cae
 *   en un balde distinto del de Vercel: nadie puede consumirle el presupuesto al
 *   SSR desde afuera.
 *
 * El techo es alto porque el consumidor legítimo es una máquina: 3000 / 15 min son
 * 200 req/min por tienda, o ~100 renders de home por minuto, muy por encima de lo
 * que un piloto va a ver. Sigue siendo un techo, que es el punto — la alternativa
 * era dejar las tres rutas sin ninguno.
 *
 * El header es del cliente y se puede rotar para conseguir baldes nuevos. Se acepta
 * a sabiendas: son tres lecturas públicas y cacheadas, sin datos de nadie adentro,
 * y el `Cache-Control` de `/order-statuses` ya las absorbe.
 */
export const ssrReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3000,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: () => !isProd,
  keyGenerator: (req) =>
    `${req.get("x-tenant-slug") || "sin-tenant"}:${ipKeyGenerator(req.ip)}`,
  store: ssrStore,
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
  // Mismo motivo que `loginLimiter`/`registerLimiter`: el contador vive en Redis y
  // se acumula entre corridas. Ningún test cubre este limiter.
  skip: () => DEFAULTS.NODE_ENV === "test",
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
  // `tests/store-chat.test.js` hace ~8 requests por corrida contra este endpoint y
  // el contador (Redis, ventana de 60 s, clave por IP) sobrevive a la corrida: dos
  // seguidas quedan al borde del tope de 20. Los 429 que sí se testean son los del
  // cost-guard por tenant, que es otro mecanismo.
  skip: () => DEFAULTS.NODE_ENV === "test",
});
