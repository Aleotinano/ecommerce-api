import { z } from "zod";

// Un componente elegido dentro de un combo. Exportado suelto porque lo usan dos
// entradas distintas: el carrito (`comboSelectionBody`) y la creación de orden
// con ítems del admin (`orderCreate`, schemas/order.schema.js).
export const comboSelectionEntry = z.object({
  productId: z.coerce
    .number({ invalid_type_error: "El ID de producto debe ser un número" })
    .int("El ID de producto debe ser un número entero")
    .positive("ID de producto inválido"),
  variantId: z.coerce
    .number({ invalid_type_error: "El ID de variante debe ser un número" })
    .int("El ID de variante debe ser un número entero")
    .positive("ID de variante inválido")
    .optional(),
  quantity: z.coerce
    .number({ invalid_type_error: "La cantidad debe ser un número" })
    .int("La cantidad debe ser un número entero")
    .positive("La cantidad debe ser mayor a 0"),
});

// Selección del cliente al armar un combo (POST /cart/combo/:productId). El
// backend re-valida contra la whitelist del combo — ver services/combos.js.
// `variantId` solo aplica si el producto elegido es VARIANTE.
export const comboSelectionBody = z.object({
  selection: z
    .array(comboSelectionEntry)
    .min(1, "Debés elegir al menos un producto para el combo"),
});
