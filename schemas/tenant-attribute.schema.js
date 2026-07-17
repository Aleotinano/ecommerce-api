import { z } from "zod";

/**
 * HEX de color (#RGB o #RRGGBB) — regla de los atributos type COLOR. Antes vivía
 * hardcodeada sobre la columna `ProductVariant.color`; ahora la aplica el service
 * (services/tenant-attributes.js) solo a los atributos que el tenant declaró COLOR.
 */
export const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const tenantAttributeParams = z.object({
  tenantId: z.coerce
    .number({ invalid_type_error: "El ID debe ser un número" })
    .int("El ID debe ser un número entero")
    .positive("El ID del tenant es inválido"),
});

// Setup ONE-TIME del catálogo de atributos del tenant (ropa: color+talle; mesa
// dulce: sabor+tamaño). El orden del array define `position` (orden de display).
export const setupTenantAttributes = z.object({
  attributes: z
    .array(
      z.object({
        key: z
          .string({ invalid_type_error: "La key debe ser texto" })
          .trim()
          .toLowerCase()
          .regex(
            /^[a-z0-9_-]{1,30}$/,
            "La key debe ser un slug (minúsculas, números, - o _, máx 30)"
          ),
        label: z
          .string({ invalid_type_error: "El label debe ser texto" })
          .trim()
          .min(1, "El label es requerido")
          .max(40, "El label es demasiado largo"),
        type: z
          .enum(["TEXT", "COLOR"], {
            invalid_type_error: "Tipo de atributo inválido",
          })
          .optional(),
      })
    )
    .min(1, "Definí al menos un atributo")
    .max(6, "Máximo 6 atributos por tenant"),
});

/**
 * Shape sintáctico de las `attributes` de una variante: pares key->valor.
 * La validación semántica (que la key exista en el catálogo del tenant, HEX para
 * type COLOR) es del service — zod no conoce el tenant.
 */
export const variantAttributes = z.record(
  z.string().max(30, "Key de atributo demasiado larga"),
  z
    .string({ invalid_type_error: "El valor del atributo debe ser texto" })
    .trim()
    .min(1, "El valor del atributo no puede estar vacío")
    .max(80, "El valor del atributo es demasiado largo")
);
