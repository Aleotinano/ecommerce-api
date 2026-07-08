import { z } from "zod";

// Selección del cliente al armar un combo (POST /cart/combo/:variantId). El
// backend re-valida contra la whitelist del combo — ver services/combos.js.
export const comboSelectionBody = z.object({
  selection: z
    .array(
      z.object({
        variantId: z.coerce
          .number({ invalid_type_error: "El ID de variante debe ser un número" })
          .int("El ID de variante debe ser un número entero")
          .positive("ID de variante inválido"),
        quantity: z.coerce
          .number({ invalid_type_error: "La cantidad debe ser un número" })
          .int("La cantidad debe ser un número entero")
          .positive("La cantidad debe ser mayor a 0"),
      })
    )
    .min(1, "Debés elegir al menos un producto para el combo"),
});
