import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),

  DATABASE_URL: z.string().min(1),
  SECRET_JWT_KEY: z.string().min(1),

  BASE_URL: z.string().url(),

  PUBLIC_KEY: z.string().min(1),
  ACCESS_TOKEN: z.string().min(1),

  ORIGINS: z.string().optional(),
});
