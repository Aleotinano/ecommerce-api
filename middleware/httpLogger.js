import pinoHttp from "pino-http";
import { logger } from "../lib/logger.js";

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
