import "dotenv/config";

import { envSchema } from "./schemas/env.schema.js";

const env = envSchema.parse(process.env);

export const DEFAULTS = {
  PORT: env.PORT,
  SECRET_JWT_KEY: env.SECRET_JWT_KEY,
  NODE_ENV: env.NODE_ENV,
  ORIGINS: env.ORIGINS ? env.ORIGINS.split(",").map((o) => o.trim()) : [],
  BASE_URL: env.BASE_URL,
  APP_URL: env.APP_URL || env.BASE_URL,
  STORE_APP_URL: env.STORE_APP_URL || "http://localhost:3000",
  DATABASE_URL: env.DATABASE_URL,
  PUBLIC_KEY: env.PUBLIC_KEY,
  ACCESS_TOKEN: env.ACCESS_TOKEN,
  CLOUDINARY_FOLDER: env.CLOUDINARY_FOLDER,
  SALT_ROUNDS: 10,
  LIMIT: 10,
  OFFSET: 0,
  SMTP: {
    HOST: env.SMTP_HOST,
    PORT: env.SMTP_PORT,
    USER: env.SMTP_USER,
    PASS: env.SMTP_PASS,
    SECURE: env.SMTP_SECURE ?? false,
    FROM: env.MAIL_FROM || "no-reply@localhost",
  },
  LOG_LEVEL:
    env.LOG_LEVEL || (env.NODE_ENV === "production" ? "info" : "debug"),
  REDIS_URL: env.REDIS_URL,
  CACHE_ENABLED: env.CACHE_ENABLED === true,
};
