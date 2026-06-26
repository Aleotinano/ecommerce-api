import { z } from "zod";

export const tenantSlugSchema = z
  .string({ required_error: "El slug del tenant es requerido" })
  .min(3, "El slug debe tener al menos 3 caracteres")
  .max(40, "El slug es demasiado largo")
  .regex(/^[a-z0-9-]+$/, "Solo minúsculas, números y guiones");

export const registerSchema = z.object({
  // Opcional: si no se envía, el servicio asigna un username genérico ("admin").
  // Solo se pide el nombre de la tienda al dar de alta.
  username: z
    .string()
    .min(3, "El nombre debe tener al menos 3 caracteres")
    .max(20, "El nombre no puede tener más de 20 caracteres")
    .regex(/^[a-zA-Z0-9_]+$/, "Solo letras, números y guión bajo")
    .optional(),

  password: z
    .string({ required_error: "La contraseña es requerida" })
    .min(6, "La contraseña debe tener al menos 6 caracteres")
    .max(100, "La contraseña es demasiado larga"),

  email: z
    .string({ required_error: "El email es requerido" })
    .email("Email inválido"),

  tenantName: z
    .string({ required_error: "El nombre del tenant es requerido" })
    .min(2, "El nombre del tenant debe tener al menos 2 caracteres")
    .max(80, "El nombre del tenant es demasiado largo")
    .regex(
      /^[\p{L}\p{N} _.&'-]+$/u,
      "El nombre del tenant contiene caracteres no permitidos"
    ),
});

export const loginSchema = z.object({
  email: z
    .string({ required_error: "El email es requerido" })
    .email("Email inválido"),
  password: z.string({ required_error: "La contraseña es requerida" }).min(1),
});

export const verifyEmailQuerySchema = z.object({
  token: z
    .string({ required_error: "El token es requerido" })
    .min(10, "Token inválido"),
});

export const resendVerificationSchema = z.object({
  email: z
    .string({ required_error: "El email es requerido" })
    .email("Email inválido"),
});
