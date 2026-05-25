import { pino } from "pino";
import { DEFAULTS } from "../config.js";

const isProd = DEFAULTS.NODE_ENV === "production";

export const logger = pino({
  level: DEFAULTS.LOG_LEVEL,
  base: undefined,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'req.headers["x-tenant-slug"]',
      "res.headers['set-cookie']",
      "*.password",
      "*.token",
    ],
    censor: "[REDACTED]",
  },
  ...(isProd
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss.l",
            ignore: "pid,hostname",
          },
        },
      }),
});

export function childLogger(bindings) {
  return logger.child(bindings);
}
