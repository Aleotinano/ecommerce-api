import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),

  DATABASE_URL: z.string().min(1),
  SECRET_JWT_KEY: z.string().min(1),

  BASE_URL: z.string().url(),
  APP_URL: z.string().url().optional(),
  STORE_APP_URL: z.string().url().optional(),

  PUBLIC_KEY: z.string().min(1),
  ACCESS_TOKEN: z.string().min(1),
  CLOUDINARY_CLOUD_NAME: z.string().min(1),
  CLOUDINARY_API_KEY: z.string().min(1),
  CLOUDINARY_API_SECRET: z.string().min(1),
  CLOUDINARY_FOLDER: z.string().min(1).default("e-commerce-express"),

  ORIGINS: z.string().optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .transform((v) => v === "true"),
  MAIL_FROM: z.string().optional(),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .optional(),

  REDIS_URL: z.string().url().optional(),
  CACHE_ENABLED: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .transform((v) => v !== "false"),

  LLM_PROVIDER: z.enum(["gemini", "anthropic"]).default("gemini"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-haiku-4-5"),
  // Base URL del adapter Anthropic. En prod apunta a api.anthropic.com; en dev se
  // puede apuntar a un server con compat de la Messages API (p. ej. Ollama en
  // http://localhost:11434). El request se arma igual: POST {base}/v1/messages.
  ANTHROPIC_BASE_URL: z.string().url().default("https://api.anthropic.com"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  // Generacion de imagenes (image-to-image), independiente del LLM de texto.
  // Reusa GEMINI_API_KEY. Por ahora solo Gemini soporta generacion de imagenes.
  IMAGE_PROVIDER: z.enum(["gemini"]).default("gemini"),
  GEMINI_IMAGE_MODEL: z.string().default("gemini-2.5-flash-image"),

  CHAT_DAILY_LIMIT: z.coerce.number().int().positive().default(500),

  // WhatsApp (canal de entrada del chatbot). Todas OPCIONALES: si faltan, el
  // modulo de WhatsApp queda inactivo y la app arranca igual. En prod el numero
  // saliente sale de la DB por tenant; en dev WHATSAPP_PHONE_NUMBER_ID es el
  // numero de prueba.
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_GRAPH_API_VERSION: z.string().default("v21.0"),
  // Clave para cifrar el access token per-tenant en reposo (AES-256-GCM, ver
  // lib/crypto.js). 32 bytes en hex (64 chars) o base64. Sin ella no se guardan
  // ni se usan tokens de DB (se cae al token global de env).
  WHATSAPP_TOKEN_ENC_KEY: z.string().optional(),
});
