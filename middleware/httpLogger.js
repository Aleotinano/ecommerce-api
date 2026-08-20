import { createHash } from "node:crypto";
import pinoHttp from "pino-http";
import { logger } from "../lib/logger.js";

// Identidad del carrito de invitado en el log de acceso. Entró para diagnosticar el
// incidente de carritos compartidos (docs/INCIDENTE_CARRITO_COMPARTIDO.md — que
// resultó ser una cuenta de admin compartida entre cinco testers, no un bug) y se
// queda mientras dure el testeo, porque es la forma barata de confirmar que cada
// visitante tiene la suya. Sacar cuando termine.
//
// Se loguea un HASH, nunca el guestId completo: es un secreto portador, quien lo
// tiene se lleva el carrito de esa persona. Y los logs de este deploy los lee más
// gente que la base. 8 hex son 32 bits: de sobra para agrupar requests de una misma
// sesión, inútil para reconstruir el UUID.
const guestFingerprint = (guestId) =>
  guestId ? createHash("sha1").update(guestId).digest("hex").slice(0, 8) : undefined;

export const httpLogger = pinoHttp({
  logger,
  customLogLevel(_req, res, err) {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  customProps(req) {
    return {
      tenantId: req.tenantId ?? req.user?.tenantId,
      userId: req.user?.id,
      // `req.cartOwner` lo setea middleware/guestCart.js, que corre bastante después
      // que este logger; no es un problema porque pino-http serializa al CERRAR la
      // respuesta, con el request ya recorrido entero.
      guest: guestFingerprint(req.cartOwner?.guestId),
    };
  },
  serializers: {
    req(req) {
      return {
        method: req.method,
        url: req.url,
        // `req.raw` es el request de Express, asi que `req.raw.ip` respeta
        // `trust proxy` y trae la IP REAL del cliente. El `req.remoteAddress` que
        // ofrece pino-http sale del socket, y detras del Funnel eso es siempre el
        // gateway del bridge de Docker (172.18.0.1) para TODAS las requests: el log
        // de acceso quedaba sin forma de distinguir un visitante de otro, y la unica
        // IP real registrada era la de proxyChain.js, que sale una vez por proceso.
        // Ver docs/DEPLOY.md paso 5.
        remoteAddress: req.raw?.ip ?? req.remoteAddress,
      };
    },
    res(res) {
      return { statusCode: res.statusCode };
    },
  },
  autoLogging: {
    ignore: (req) => req.url === "/health" || req.url.startsWith("/favicon"),
  },
});
