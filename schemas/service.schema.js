import { z } from "zod";

// Turno de una línea de SERVICIO: `{ date: "YYYY-MM-DD", time: "HH:MM",
// recipientName? }`. Exportado suelto porque lo usan tres entradas: el carrito
// (`cartItemBody`), la creación de orden con ítems del admin (`orderCreate`) y la
// revisión (`orderReview`), schemas/order.schema.js.
//
// Acá solo se valida la FORMA. Si el producto es un servicio, si pide destinatario o
// si la fecha ya pasó lo decide `resolveServiceBooking` (helpers/service-booking.js),
// que es quien conoce el producto.

// Mismo patrón que `cashSchedule` (services/cash-register-schedule.js).
const HHMM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// El regex deja pasar un 2026-02-30; el round-trip por Date no (lo corre a marzo).
const isRealDate = (value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export const serviceBooking = z.object({
  date: z
    .string({
      required_error: "La fecha del servicio es requerida",
      invalid_type_error: "La fecha del servicio debe ser texto",
    })
    .regex(ISO_DATE_PATTERN, "La fecha del servicio debe ser YYYY-MM-DD")
    .refine(isRealDate, "La fecha del servicio no existe"),
  time: z
    .string({
      required_error: "El horario del servicio es requerido",
      invalid_type_error: "El horario del servicio debe ser texto",
    })
    .regex(HHMM_PATTERN, "El horario del servicio debe ser HH:MM (24 h)"),
  // Para quién es: el nombre del perro, del hijo, de la empresa. null/ausente = para
  // quien lo contrata.
  recipientName: z
    .string({ invalid_type_error: "El destinatario debe ser texto" })
    .trim()
    .max(100, "El destinatario no puede superar 100 caracteres")
    .nullable()
    .optional(),
});
