export const DEFAULTS = {
  PORT: process.env.PORT,
  ORIGINS: process.env.ORIGINS?.split(","),
  SECRET_JWT_KEY: process.env.SECRET_JWT_KEY,
  NODE_ENV: process.env.NODE_ENV || "production",
  SALT_ROUNDS: 10,
  LIMIT: 10,
  OFFSET: 0,
};
