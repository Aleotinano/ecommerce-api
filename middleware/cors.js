import cors from "cors";
import { DEFAULTS } from "../config.js";

const ACCEPTED_ORIGINS = DEFAULTS.ORIGINS;

export const middleWare = ({ acceptedOrigins = ACCEPTED_ORIGINS } = {}) => {
  return cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      if (acceptedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("El origen no esta permitido"));
    },
  });
};
