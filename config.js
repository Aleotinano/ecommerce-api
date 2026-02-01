export const DEFAULTS = {
  PORT: process.env.PORT,
  ORIGINS: process.env.ORIGINS?.split(","),
  SECRET_JWT_KEY: process.env.SECRET_JWT_KEY,
  NODE_ENV: process.env.NODE_ENV,
  SALT_ROUNDS: 10,
  LIMIT: 10,
  OFFSET: 0,
  ADMIN: {
    USERNAME: process.env._USERNAME,
    PASSWORD: process.env._PASSWORD,
  },
};
