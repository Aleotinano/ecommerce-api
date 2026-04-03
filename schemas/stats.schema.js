import { z } from "zod";

export const StatsQuery = z.object({
  days: z.coerce
    .number({ invalid_type_error: "El rango de dias debe ser un numero" })
    .int("El rango de dias debe ser un numero entero")
    .min(7, "El rango minimo es de 7 dias")
    .max(365, "El rango maximo es de 365 dias")
    .default(30),
  lowStockThreshold: z.coerce
    .number({
      invalid_type_error: "El umbral de stock bajo debe ser un numero",
    })
    .int("El umbral de stock bajo debe ser un numero entero")
    .min(0, "El umbral de stock bajo no puede ser negativo")
    .max(1000, "El umbral de stock bajo es demasiado alto")
    .default(5),
});
