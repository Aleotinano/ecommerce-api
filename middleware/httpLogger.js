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
        remoteAddress: req.remoteAddress,
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
