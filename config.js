import { envSchema } from "./schemas/env.schema.js";

const env = envSchema.parse(process.env);

export const DEFAULTS = {
  PORT: env.PORT,
  SECRET_JWT_KEY: env.SECRET_JWT_KEY,
  NODE_ENV: env.NODE_ENV,
  ORIGINS: env.ORIGINS ? env.ORIGINS.split(",").map((o) => o.trim()) : [],
  BASE_URL: env.BASE_URL,
  DATABASE_URL: env.DATABASE_URL,
  PUBLIC_KEY: env.PUBLIC_KEY,
  ACCESS_TOKEN: env.ACCESS_TOKEN,
  SALT_ROUNDS: 10,
  LIMIT: 10,
  OFFSET: 0,
};
