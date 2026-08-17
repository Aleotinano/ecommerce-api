import crypto from "node:crypto";
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
 * saltean el limiter general y van a los dos de acá abajo.
 *
 * Se compara contra `req.path` sin barra final: el middleware global corre antes
 * que cualquier router, así que ve el path completo.
 */
const SSR_PATHS = new Set(["/order-statuses", "/store/config", "/store/page"]);

const isSsrReadPath = (req) =>
  SSR_PATHS.has(req.path.length > 1 ? req.path.replace(/\/+$/, "") : req.path);

/**
 * Estas tres rutas las pegan DOS poblaciones con perfiles de consumo incompatibles,
 * y por eso no pueden compartir un techo:
 *
 * - El **SSR**: una sola IP (la de egreso de Vercel) que agrega a todos los
 *   visitantes de una tienda. Su techo es de máquina.
 * - Un **browser suelto**: una persona. Un techo de máquina acá no limita nada —
 *   3000 req / 15 min son 3,3 req/s sostenidos, absurdo para un visitante y de
 *   sobra para voltear un J1900 con disco mecánico.
 *
 * Se separan de dos formas, en orden de preferencia:
 *
 * 1. **`SSR_SHARED_SECRET` seteada** (lo bueno): sólo entra al balde de máquina
 *    quien presente ese secreto en `X-SSR-Key`. Es explícito, no se puede fingir
 *    sin el secreto, y —lo más valioso— no depende de la semántica de ningún header
 *    del browser: si algún día se agrega un rewrite de Vercel, esta separación
 *    sobrevive intacta.
 * 2. **Sin secreto** (el fallback): se infiere por el header `Origin`. Un fetch
 *    server-to-server de Next no lo manda y un browser en cross-origin lo manda
 *    siempre — que es el caso hoy, porque no hay rewrite y el front le pega directo
 *    al Funnel. Mismo criterio que middleware/cors.js usa para "esto no es un
 *    browser". Funciona, pero `Origin` se puede omitir con curl.
 *
 * Con el rewrite puesto y SIN secreto, el modo 2 se da vuelta y falla en silencio:
 * un GET same-origin del browser tampoco manda `Origin`, así que TODO el tráfico de
 * browser caería en el balde de máquina. Ese es el argumento fuerte para setear el
 * secreto, más que el curl. Ver docs/DEPLOY.md.
 *
 * Los dos limiters se montan juntos y cada uno se saltea a la población del otro,
 * así que toda request pasa por exactamente uno.
 */
const SSR_KEY_HEADER = "x-ssr-key";
const ssrSecret = DEFAULTS.SSR_SHARED_SECRET;

const hasValidSsrKey = (req) => {
  const provided = req.get(SSR_KEY_HEADER);
  if (!provided) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(ssrSecret);
  // `timingSafeEqual` TIRA si los largos difieren, así que hay que cortar antes.
  // Se filtra el largo del secreto, que no alcanza para deducirlo.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const isBrowserRequest = (req) => Boolean(req.get("origin"));

const isMachineRequest = (req) =>
  ssrSecret ? hasValidSsrKey(req) : !isBrowserRequest(req);

let generalStore,
  loginStore,
  registerStore,
  webhookStore,
  chatStore,
  ssrStore,
  browserReadStore;

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

try {
  browserReadStore = createStore("rl:read:");
} catch {
  browserReadStore = undefined;
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
 * Mitad de máquina: las tres lecturas de `SSR_PATHS` que vienen del SSR (ver
 * `isMachineRequest`).
 *
 * La clave es `<tenant>:<ip>`, no la IP sola. Desde el SSR el slug es fijo por
 * tienda y la IP es la de Vercel, así que cada tenant tiene su propio balde y
 * ninguno puede tirar abajo el render de otro. La IP sigue en la clave para que,
 * con el fallback de `Origin` activo, quien lo omita a mano caiga en el suyo y no
 * en el de Vercel.
 *
 * 3000 / 15 min son 200 req/min por tienda, o ~100 renders de home por minuto. Es
 * el techo del AGREGADO de una tienda entera, no de una persona: por eso el número
 * grande vive acá y no en el limiter de browser. Si el J1900 sufre antes de llegar
 * a eso, este es el número a bajar.
 *
 * El header de tenant es del cliente y se puede rotar para conseguir baldes nuevos.
 * Se acepta a sabiendas: son tres lecturas públicas y cacheadas, sin datos de nadie
 * adentro, y el `Cache-Control` de `/order-statuses` ya las absorbe.
 */
export const ssrReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3000,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: (req) => !isProd || !isMachineRequest(req),
  keyGenerator: (req) =>
    `${req.get("x-tenant-slug") || "sin-tenant"}:${ipKeyGenerator(req.ip)}`,
  store: ssrStore,
  handler: rateLimitHandler,
});

/**
 * Mitad humana: las mismas tres rutas cuando NO son del SSR. Clave por IP a secas —
 * acá un visitante es un visitante. Con el secreto seteado, acá cae también quien
 * llegue sin `X-SSR-Key` aunque tampoco mande `Origin`: es el cierre del agujero de
 * curl.
 *
 * 120 / 15 min es holgado para lo que se espera, que es casi nada: las tres las pide
 * el SSR, no el browser. `/order-statuses` es lo único que un front podría pedir del
 * lado del cliente, y sale con `Cache-Control: public, max-age=3600`, así que ni
 * siquiera debería volver a pedirla dentro de la ventana.
 *
 * Deliberadamente MÁS BAJO que el techo general de 200: son lecturas baratas pero
 * repetitivas contra un J1900 con disco mecánico, y no hay caso de uso legítimo que
 * necesite más.
 */
export const browserReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: (req) => !isProd || isMachineRequest(req),
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  store: browserReadStore,
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
