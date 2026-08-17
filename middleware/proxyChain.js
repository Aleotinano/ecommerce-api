import { DEFAULTS } from "../config.js";
import { logger } from "../lib/logger.js";

/**
 * Loguea UNA vez, en el primer request real, la cadena de proxies tal como llega.
 *
 * Existe porque `TRUST_PROXY` es la config más fácil de tener mal sin enterarse: si
 * el número no coincide con la cantidad de saltos, `req.ip` es la IP del proxy y
 * TODOS los rate limiters dejan de discriminar visitantes — un solo balde para la
 * tienda entera, sin ningún error que lo delate.
 *
 * Contesta dos preguntas de una:
 *
 * 1. **Si Tailscale Funnel agrega su entrada a `X-Forwarded-For` o lo pisa.** Es un
 *    hecho que no se puede deducir leyendo este repo. Si `xForwardedFor` sale
 *    `null`, Funnel no lo propaga y la IP real del visitante NO llega nunca —
 *    ningún valor de `TRUST_PROXY` lo arregla y habría que replantear el rate
 *    limiting.
 * 2. **Si alguien agregó un salto después** (el caso típico: un rewrite de Vercel
 *    delante del Funnel). Ahí `hops` pasa a 2 y `TRUST_PROXY` se queda en 1.
 *
 * Compará `reqIp` con `socketRemoteAddress`: si son iguales y hay `xForwardedFor`,
 * Express no está confiando en el header y `TRUST_PROXY` está corto.
 *
 * Una sola línea por proceso, a propósito: es un diagnóstico de arranque, no
 * telemetría. `/health` se saltea porque lo pega el HEALTHCHECK del contenedor
 * desde adentro y no dice nada de la cadena externa.
 */
let alreadyLogged = false;

export function logProxyChainOnce(req, _res, next) {
  if (alreadyLogged || req.path === "/health") return next();
  alreadyLogged = true;

  const raw = req.headers["x-forwarded-for"];

  logger.info(
    {
      xForwardedFor: raw ?? null,
      hops: raw ? raw.split(",").length : 0,
      reqIp: req.ip,
      socketRemoteAddress: req.socket?.remoteAddress ?? null,
      trustProxy: DEFAULTS.TRUST_PROXY,
    },
    "cadena de proxies del primer request (ver docs/DEPLOY.md, TRUST_PROXY)"
  );

  next();
}

// Sólo para los tests: el flag es de módulo y sobrevive entre casos.
export function resetProxyChainLog() {
  alreadyLogged = false;
}
