import { z } from "zod";
import { isGoogleMapsUrl } from "./order.schema.js";

// Mismos límites que el bloque `fulfillmentFields` de order.schema.js: la libreta
// es la fuente que el checkout copia a las columnas planas de Order. `nullable`
// además de `optional` para que un PATCH pueda limpiar un campo explícitamente.
const locationFields = {
  addressText: z
    .string({ invalid_type_error: "addressText debe ser texto" })
    .trim()
    .min(1, "addressText no puede estar vacío")
    .max(300, "addressText no puede superar 300 caracteres")
    .nullable()
    .optional(),
  addressLat: z.coerce.number().min(-90).max(90).nullable().optional(),
  addressLng: z.coerce.number().min(-180).max(180).nullable().optional(),
  addressDetails: z
    .string({ invalid_type_error: "addressDetails debe ser texto" })
    .trim()
    .max(300, "addressDetails no puede superar 300 caracteres")
    .nullable()
    .optional(),
  addressMapsUrl: z
    .string({ invalid_type_error: "addressMapsUrl debe ser texto" })
    .trim()
    .max(500, "addressMapsUrl no puede superar 500 caracteres")
    .refine(isGoogleMapsUrl, "addressMapsUrl debe ser un link de Google Maps")
    .nullable()
    .optional(),
};

const labelField = z
  .string({
    required_error: "El nombre de la dirección es requerido",
    invalid_type_error: "El nombre debe ser texto",
  })
  .trim()
  .min(1, "El nombre no puede estar vacío")
  .max(60, "El nombre no puede superar 60 caracteres");

const isDefaultField = z
  .boolean({ invalid_type_error: "isDefault debe ser un booleano" })
  .optional();

// lat/lng viajan juntos, igual que en el checkout. Espeja el CHECK
// "UserAddress_latlng_together_check" de la migración.
function checkLatLngTogether(data, ctx) {
  if ((data.addressLat != null) !== (data.addressLng != null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["addressLng"],
      message: "addressLat y addressLng deben enviarse juntos",
    });
  }
}

export const createAddress = z
  .object({
    label: labelField,
    isDefault: isDefaultField,
    ...locationFields,
  })
  .superRefine((data, ctx) => {
    if (data.addressText == null && data.addressMapsUrl == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["addressText"],
        message: "Hace falta addressText y/o addressMapsUrl",
      });
    }
    checkLatLngTogether(data, ctx);
  });

// El update no puede exigir acá que quede una ubicación: un PATCH que solo
// renombra no manda ningún campo de dirección. Lo valida el service contra la
// fila mergeada (ADDRESS_LOCATION_REQUIRED).
export const updateAddress = z
  .object({
    label: labelField.optional(),
    isDefault: isDefaultField,
    ...locationFields,
  })
  .strip()
  .superRefine(checkLatLngTogether);
