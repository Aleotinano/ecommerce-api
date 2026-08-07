import { z } from "zod";

import { MANUAL_MOVEMENT_TYPES } from "../services/cash-register-math.js";
import { dayBoundary } from "./date.schema.js";

// La vía por la que se movió la plata. GATEWAY (MercadoPago) no entra: esa plata
// nunca pasa por el cajón, y hay un CHECK en la base que además lo impide.
const CASH_CHANNELS = ["CASH", "TRANSFER"];
const CATEGORY_APPLIES = ["INCOME", "EXPENSE", "BOTH"];

const money = (label) =>
  z.coerce
    .number({
      required_error: `${label} es requerido`,
      invalid_type_error: `${label} debe ser un número`,
    })
    .finite(`${label} debe ser un número válido`);

const note = z
  .string({ invalid_type_error: "La nota debe ser texto" })
  .max(500, "La nota es demasiado larga")
  .trim()
  .nullable()
  .optional();

export const openCashSession = z.object({
  // Los dos saldos con los que arranca la caja, los dos opcionales: el que falte
  // toma el arrastre del cierre anterior (la caja es continua, no arranca de cero
  // cada día). `0` explícito sí arranca vacío — un local que empieza sin cambio en
  // el cajón es un caso real.
  openingAmount: money("El monto de apertura")
    .min(0, "El monto de apertura no puede ser negativo")
    .optional(),
  openingTransferAmount: money("El saldo en transferencias")
    .min(0, "El saldo en transferencias no puede ser negativo")
    .optional(),
  note,
});

export const closeCashSession = z.object({
  countedCashAmount: money("El efectivo contado").min(
    0,
    "El efectivo contado no puede ser negativo"
  ),
  // Contar el banco es opcional: sin este número no se firma diferencia de
  // transferencias (queda null, no 0) y el saldo continúa con el esperado.
  countedTransferAmount: money("El saldo contado en transferencias")
    .min(0, "El saldo en transferencias no puede ser negativo")
    .nullable()
    .optional(),
  // La caja grande: lo que se retira del cajón al cerrar. Lo que queda —la caja
  // chica— es con lo que abre el turno siguiente. Sin este monto no se retira nada y
  // arrastra todo, que es como venía. Que no supere lo contado lo valida el servicio,
  // que es donde están los dos números juntos.
  withdrawnCashAmount: money("El retiro")
    .min(0, "El retiro no puede ser negativo")
    .optional(),
  // Cerrar firma el arqueo y la caja SIGUE con la caja chica. `false` es la acción
  // explícita de dejar la caja cerrada (fin de temporada), que mientras dure bloquea
  // los cobros en efectivo.
  reopen: z
    .boolean({ invalid_type_error: "reopen debe ser booleano" })
    .default(true),
  note,
});

export const createCashMovement = z.object({
  // Solo los manuales. Los ORDER_* los escribe el enganche con el libro de cobros
  // de las órdenes, nunca un request.
  type: z.enum(MANUAL_MOVEMENT_TYPES, {
    errorMap: () => ({
      message: `El tipo debe ser uno de: ${MANUAL_MOVEMENT_TYPES.join(", ")}`,
    }),
  }),

  channel: z.enum(CASH_CHANNELS, {
    errorMap: () => ({ message: `La vía debe ser una de: ${CASH_CHANNELS.join(", ")}` }),
  }),

  amount: money("El monto").positive("El monto debe ser mayor a 0"),

  // Obligatoria: un egreso sin etiqueta es un egreso que no se puede reportar, y
  // el motivo por el que existe el catálogo es justamente poder contestar "cuánto
  // se fue en insumos". El tenant arranca con las etiquetas por defecto sembradas.
  categoryId: z.coerce
    .number({
      required_error: "La etiqueta es requerida",
      invalid_type_error: "La etiqueta debe ser un ID numérico",
    })
    .int()
    .positive("Etiqueta inválida"),

  // A quién se le pagó / de quién entró. Texto libre a propósito: el repartidor al
  // que se le paga el día no es un usuario del sistema.
  payee: z
    .string({ invalid_type_error: "El destinatario debe ser texto" })
    .max(120, "El destinatario es demasiado largo")
    .trim()
    .nullable()
    .optional(),

  note,
});

const categoryKey = z
  .string({ required_error: "La clave es requerida" })
  .min(2, "La clave es demasiado corta")
  .max(40, "La clave es demasiado larga")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "La clave debe ser un slug en minúsculas (ej: insumos, aporte-cambio)"
  );

export const createCashCategory = z.object({
  key: categoryKey,
  label: z
    .string({ required_error: "El nombre es requerido" })
    .min(1, "El nombre no puede estar vacío")
    .max(60, "El nombre es demasiado largo")
    .trim(),
  applies: z
    .enum(CATEGORY_APPLIES, {
      errorMap: () => ({ message: `Debe aplicar a: ${CATEGORY_APPLIES.join(", ")}` }),
    })
    .default("EXPENSE"),
  position: z.coerce.number().int().min(0).optional(),
});

// `key` no se puede editar: es el slug estable con el que un reporte guardado se
// refiere a la etiqueta. Para renombrar está `label`.
export const updateCashCategory = z
  .object({
    label: z
      .string({ invalid_type_error: "El nombre debe ser texto" })
      .min(1, "El nombre no puede estar vacío")
      .max(60, "El nombre es demasiado largo")
      .trim()
      .optional(),
    applies: z
      .enum(CATEGORY_APPLIES, {
        errorMap: () => ({ message: `Debe aplicar a: ${CATEGORY_APPLIES.join(", ")}` }),
      })
      .optional(),
    position: z.coerce.number().int().min(0).optional(),
    isActive: z.boolean({ invalid_type_error: "isActive debe ser booleano" }).optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "No hay cambios para actualizar",
  });

export const cashSessionQuery = z.object({
  from: dayBoundary("start", "desde"),
  to: dayBoundary("end", "hasta"),
  limit: z.coerce.number().int().positive().max(100, "El máximo es 100").default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const cashSummaryQuery = z.object({
  from: dayBoundary("start", "desde"),
  to: dayBoundary("end", "hasta"),
});

export const cashCategoryQuery = z.object({
  includeInactive: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});
