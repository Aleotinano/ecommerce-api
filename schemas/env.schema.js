import { z } from "zod";

const envShape = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),

  // Expresión `trust proxy` de Express: cantidad de proxies delante de la app
  // ("1" detrás del Tailscale Funnel del deploy), "true"/"false", o una lista de
  // IPs/CIDRs.
  // El default "0" es el correcto en local, donde no hay nadie adelante.
  //
  // Sin esto, detrás de un reverse proxy `req.ip` es la IP del proxy y los cinco
  // rate limiters de middleware/rateLimit.js meten a TODOS los visitantes en el
  // mismo balde. Ver docs/DEPLOY.md.
  TRUST_PROXY: z.string().default("0"),

  DATABASE_URL: z.string().min(1),
  SECRET_JWT_KEY: z.string().min(1),

  BASE_URL: z.string().url(),
  APP_URL: z.string().url().optional(),
  STORE_APP_URL: z.string().url().optional(),

  // MercadoPago. OPCIONALES: la integración existe pero hoy no la usa ningún
  // tenant — todos cobran en efectivo o por transferencia, que es un flujo
  // enteramente manual (ver `paymentConfirmedById` en el schema de Prisma y
  // MANUAL_CHANNELS en schemas/order.schema.js). Sin `ACCESS_TOKEN` el módulo
  // queda inactivo y la app arranca igual; sólo falla el request que intente
  // crear una preferencia, con `MERCADOPAGO_NOT_CONFIGURED` (503).
  //
  // Eran requeridas y eso obligaba a inventar un token falso para poder
  // deployar. `PUBLIC_KEY` además no la lee nadie: se declara acá, se expone en
  // DEFAULTS y no la consume ninguna línea del código.
  PUBLIC_KEY: z.string().min(1).optional(),
  ACCESS_TOKEN: z.string().min(1).optional(),
  // Cuenta de Cloudinary de la PLATAFORMA. Opcionales a propósito: cada cliente de
  // producción carga la suya en `TenantConfig` (ver lib/cloudinary.js), así que un
  // deploy donde todas las tiendas tienen cuenta propia no necesita ninguna acá — y
  // dejarlas vacías es lo que garantiza que ningún archivo de un cliente pueda
  // terminar en nuestra cuenta por accidente.
  //
  // Con esto vacío, un tenant sin credenciales propias no puede subir nada
  // (`CLOUDINARY_NOT_CONFIGURED`). Lo que NO se rompe es ver las imágenes ya
  // subidas: son URLs públicas y las sirve el CDN sin credenciales.
  CLOUDINARY_CLOUD_NAME: z.string().min(1).optional(),
  CLOUDINARY_API_KEY: z.string().min(1).optional(),
  CLOUDINARY_API_SECRET: z.string().min(1).optional(),
  CLOUDINARY_FOLDER: z.string().min(1).default("e-commerce-express"),

  ORIGINS: z.string().optional(),

  // Secreto compartido con el SERVIDOR del frontend (no con el browser). Las tres
  // lecturas que hace el SSR lo mandan en `X-SSR-Key` y eso las manda al balde de
  // rate limit de máquina, mucho más alto que el de una persona
  // (middleware/rateLimit.js).
  //
  // Opcional a propósito: sin ella se cae a distinguir por el header `Origin`, que
  // es lo que se hacía antes y funciona, sólo que se puede omitir con curl.
  //
  // No da acceso a nada: las tres rutas son públicas y cacheadas. Lo único que
  // compra es un techo más alto, así que filtrarlo es molesto, no grave. Del lado
  // de Next NO puede llamarse `NEXT_PUBLIC_*`: esas se inlinean en el bundle del
  // browser y el secreto viajaría a cada visitante.
  SSR_SHARED_SECRET: z.string().optional(),

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
  // Clave para cifrar los secretos per-tenant en reposo (access token de WhatsApp
  // y credenciales de Cloudinary del cliente; AES-256-GCM, ver lib/crypto.js).
  // 32 bytes en hex (64 chars) o base64. Sin ella no se guardan ni se usan
  // secretos de DB (se cae a la cuenta / token global de env).
  //
  // `WHATSAPP_TOKEN_ENC_KEY` es el nombre viejo y sigue funcionando como fallback:
  // renombrarlo no puede exigir tocar el deploy.
  SECRET_ENC_KEY: z.string().optional(),
  WHATSAPP_TOKEN_ENC_KEY: z.string().optional(),
});

// En producción, `ORIGINS` vacía no degrada nada: **rechaza todas** las requests
// de browser, porque fuera de dev no hay ningún origen permitido por default
// (middleware/cors.js). Y hasta acá la app arrancaba igual, así que el síntoma era
// un panel entero muerto con un error de CORS y ninguna pista de por qué.
//
// Fallar al arrancar es más ruidoso y mucho más barato de diagnosticar: el
// contenedor no levanta y el mensaje dice exactamente qué falta.
//
// El storefront TAMPOCO tiene salida propia: `storeCors` acepta cualquier origen,
// pero el CORS global se monta antes en app.js y rechaza con 403 antes de entrar
// al router de /store. O sea que el dominio de cada tienda también va en esta
// lista. Ver docs/DEPLOY.md.
export const envSchema = envShape.superRefine((env, ctx) => {
  if (env.NODE_ENV === "production" && !env.ORIGINS?.trim()) {
    ctx.addIssue({
      code: "custom",
      path: ["ORIGINS"],
      message:
        "ORIGINS es obligatoria con NODE_ENV=production: sin ella el panel admin " +
        "y las tiendas rechazan todas las requests por CORS. Es un CSV con el " +
        "origen del panel y el de CADA storefront, " +
        'ej. "https://panel.midominio.com,https://tienda.midominio.com".',
    });
  }
});
