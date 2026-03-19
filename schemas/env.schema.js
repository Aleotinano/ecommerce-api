import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),

  DATABASE_URL: z.string().min(1),
  SECRET_JWT_KEY: z.string().min(1),

  BASE_URL: z.string().url(),

  PUBLIC_KEY: z.string().min(1),
  ACCESS_TOKEN: z.string().min(1),
  CLOUDINARY_CLOUD_NAME: z.string().min(1),
  CLOUDINARY_API_KEY: z.string().min(1),
  CLOUDINARY_API_SECRET: z.string().min(1),
  CLOUDINARY_FOLDER: z.string().min(1).default("e-commerce-express"),

  ORIGINS: z.string().optional(),
});
