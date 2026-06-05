import cors from "cors";
import { DEFAULTS } from "../config.js";

const ACCEPTED_ORIGINS = DEFAULTS.ORIGINS;
const isProd = DEFAULTS.NODE_ENV === "production";

// En desarrollo, cualquier puerto de localhost/127.0.0.1 es válido
const isLocalhost = (origin) =>
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

export const middleWare = ({ acceptedOrigins = ACCEPTED_ORIGINS } = {}) => {
  return cors({
    origin: (origin, callback) => {
      if (!origin) {
        if (isProd) return callback(new Error("El origen no esta permitido"));
        return callback(null, true);
      }

      if (!isProd && isLocalhost(origin)) {
        return callback(null, true);
      }

      if (acceptedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("El origen no esta permitido"));
    },
    credentials: true,
  });
};

export const storeCors = () => {
  return cors({
    origin: (origin, callback) => {
      if (!origin) {
        if (isProd) return callback(new Error("El origen no esta permitido"));
        return callback(null, true);
      }
      callback(null, true);
    },
    credentials: true,
    exposedHeaders: ["Authorization"],
  });
};
