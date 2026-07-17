import prisma from "../lib/prisma.js";
import { createError } from "../helpers/error.js";
import { wrap, del, delPattern, tenantNs } from "../lib/cache.js";
import { HEX_COLOR_REGEX } from "../schemas/tenant-attribute.schema.js";

const TENANT_ATTRIBUTES_TTL = 600;

const ATTRIBUTE_SELECT = { key: true, label: true, type: true, position: true };

function tenantAttributesKey(tenantId) {
  return `${tenantNs(tenantId)}:attrs`;
}

async function invalidateAttributesCache(tenantId) {
  await del(tenantAttributesKey(tenantId));
  // El shape de filtros/opciones del storefront depende del catálogo.
  await delPattern(`${tenantNs(tenantId)}:prod:*`);
}

/**
 * Catálogo de atributos de variante del tenant. Es un seteo ONE-TIME (onboarding):
 * cambiar keys/tipos después dejaría inconsistentes las `attributes` ya escritas en
 * las variantes, por eso `setup` devuelve 409 si el catálogo ya existe.
 */
export const TenantAttributeModel = {
  async get({ tenantId }) {
    return wrap(tenantAttributesKey(tenantId), TENANT_ATTRIBUTES_TTL, () =>
      prisma.tenantAttribute.findMany({
        where: { tenantId },
        select: ATTRIBUTE_SELECT,
        orderBy: { position: "asc" },
      })
    );
  },

  async setup({ tenantId, attributes }) {
    const seen = new Set();
    for (const attribute of attributes) {
      if (seen.has(attribute.key)) {
        throw createError(
          `El atributo "${attribute.key}" está repetido`,
          "DUPLICATE_ATTRIBUTE",
          400
        );
      }
      seen.add(attribute.key);
    }

    const created = await prisma.$transaction(async (tx) => {
      const existing = await tx.tenantAttribute.count({ where: { tenantId } });
      if (existing > 0) {
        throw createError(
          "Los atributos del tenant ya fueron definidos",
          "ATTRIBUTES_ALREADY_SET",
          409
        );
      }

      await tx.tenantAttribute.createMany({
        data: attributes.map((attribute, index) => ({
          tenantId,
          key: attribute.key,
          label: attribute.label,
          type: attribute.type ?? "TEXT",
          position: index,
        })),
      });

      return tx.tenantAttribute.findMany({
        where: { tenantId },
        select: ATTRIBUTE_SELECT,
        orderBy: { position: "asc" },
      });
    });

    await invalidateAttributesCache(tenantId);

    return created;
  },

  /**
   * Valida y normaliza las `attributes` de una variante contra el catálogo del
   * tenant: toda key debe existir, y si el atributo es COLOR el valor debe ser HEX.
   * Devuelve el objeto con las keys EN EL ORDEN del catálogo (`position`) — el orden
   * de inserción JSON queda estable y downstream (título de MercadoPago, vistas del
   * bot) puede usar `Object.values()` sin conocer el catálogo.
   */
  async validateAttributes({ tenantId, attributes }) {
    const entries = Object.entries(attributes ?? {});
    if (!entries.length) return {};

    const catalog = await this.get({ tenantId });
    const byKey = new Map(catalog.map((attribute) => [attribute.key, attribute]));

    const cleaned = {};
    for (const [rawKey, rawValue] of entries) {
      const key = String(rawKey).trim().toLowerCase();
      const definition = byKey.get(key);
      if (!definition) {
        throw createError(
          `El atributo "${rawKey}" no está definido para esta tienda`,
          "UNKNOWN_ATTRIBUTE",
          400,
          { validKeys: catalog.map((attribute) => attribute.key) }
        );
      }

      const value = String(rawValue).trim();
      if (!value) {
        throw createError(
          `El atributo "${definition.label}" no puede estar vacío`,
          "INVALID_ATTRIBUTE_VALUE",
          400
        );
      }
      if (definition.type === "COLOR" && !HEX_COLOR_REGEX.test(value)) {
        throw createError(
          `El atributo "${definition.label}" debe ser un HEX válido (ej: #1A2B3C o #ABC)`,
          "INVALID_ATTRIBUTE_VALUE",
          400
        );
      }

      cleaned[key] = value;
    }

    const normalized = {};
    for (const attribute of catalog) {
      if (cleaned[attribute.key] !== undefined) {
        normalized[attribute.key] = cleaned[attribute.key];
      }
    }
    return normalized;
  },
};
