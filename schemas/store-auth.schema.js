import { z } from "zod";

export const customerRegisterSchema = z.object({
  username: z
    .string({ required_error: "El nombre de usuario es requerido" })
    .min(3, "El nombre debe tener al menos 3 caracteres")
    .max(20, "El nombre no puede tener más de 20 caracteres")
    .regex(/^[a-zA-Z0-9_]+$/, "Solo letras, números y guión bajo"),

  password: z
    .string({ required_error: "La contraseña es requerida" })
    .min(6, "La contraseña debe tener al menos 6 caracteres")
    .max(100, "La contraseña es demasiado larga"),

  email: z
    .string({ required_error: "El email es requerido" })
    .email("Email inválido"),

  // Texto libre a propósito: la persona escribe "264 15 412-3456" y el largo
  // cubre cualquier forma razonable. La normalización a E.164 la hace
  // `normalizeCustomerPhone` en el service, que es también quien decide si el
  // número es recuperable. Si es OBLIGATORIO o no depende del tenant
  // (`customerPhoneMode`), y eso Zod no lo sabe: se valida en el service.
  phone: z
    .string({ invalid_type_error: "El teléfono debe ser texto" })
    .trim()
    .max(30, "El teléfono es demasiado largo")
    .nullable()
    .optional(),
});
