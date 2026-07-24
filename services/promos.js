import prisma from "../lib/prisma.js";
import { createError } from "../helpers/error.js";
import { roundMoney } from "../helpers/price.js";
import { invalidateProductsCache } from "./productos.js";

/**
 * Trae, para un conjunto de `productIds` del tenant, los escalones (`tiers`) de su
 * Promo ACTIVA (si tiene una). `client` es `prisma` o un cliente de transacción — se
 * llama tanto desde `priceItems` (dentro de tx) como desde el carrito (sin tx).
 * Devuelve `Map<productId, tiers[]>` con `tiers` ordenados ascendente por `minQty`;
 * un producto sin promo activa simplemente no aparece en el Map.
 */
export async function getPromoTiersByProduct(client, tenantId, productIds) {
  const links = await client.promoProduct.findMany({
    where: { tenantId, productId: { in: productIds }, promo: { isActive: true } },
    include: { promo: { include: { tiers: { orderBy: { minQty: "asc" } } } } },
  });

  const map = new Map();
  for (const link of links) {
    // Invariante de escritura: a lo sumo una promo activa por producto (ver
    // ensureNoActivePromoConflict). Si por algún motivo hubiera más de una, no
    // rompemos el pricing: concatenamos y reordenamos en vez de tirar error acá.
    const existing = map.get(link.productId) ?? [];
    const merged = [...existing, ...link.promo.tiers].sort((a, b) => a.minQty - b.minQty);
    map.set(link.productId, merged);
  }
  return map;
}

/** Escalón con mayor `minQty` que `quantity` todavía cumple, o `null` si ninguno. */
export function pickPromoTier(tiers, quantity) {
  let best = null;
  for (const tier of tiers ?? []) {
    if (quantity >= tier.minQty && (!best || tier.minQty > best.minQty)) {
      best = tier;
    }
  }
  return best;
}

/** Aplica el descuento del escalón a un precio unitario, redondeado a 2 decimales. */
export function applyPromoDiscount(unitPrice, tier) {
  if (!tier) return unitPrice;
  return roundMoney(unitPrice * (1 - tier.discountPercentage / 100));
}

function validateTiers(tiers) {
  const seenMinQty = new Set();
  let prevMinQty = -Infinity;
  let prevDiscount = -Infinity;

  for (const tier of tiers) {
    if (seenMinQty.has(tier.minQty)) {
      throw createError(
        "No puede haber dos escalones con la misma cantidad mínima",
        "PROMO_TIER_DUPLICATE_MINQTY",
        400
      );
    }
    seenMinQty.add(tier.minQty);
  }

  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);
  for (const tier of sorted) {
    if (tier.minQty <= prevMinQty || tier.discountPercentage <= prevDiscount) {
      throw createError(
        "El porcentaje de descuento debe crecer junto con la cantidad mínima",
        "PROMO_TIER_NOT_INCREASING",
        400
      );
    }
    prevMinQty = tier.minQty;
    prevDiscount = tier.discountPercentage;
  }
}

async function validateProducts(tx, tenantId, productIds) {
  const products = await tx.product.findMany({
    where: { id: { in: productIds }, tenantId },
    select: { id: true, type: true },
  });

  const foundIds = new Set(products.map((p) => p.id));
  const missing = productIds.filter((id) => !foundIds.has(id));
  if (missing.length) {
    const error = createError("Producto no encontrado", "PRODUCT_NOT_FOUND", 404);
    error.details = { productIds: missing };
    throw error;
  }

  const comboIds = products.filter((p) => p.type !== "PRODUCTO").map((p) => p.id);
  if (comboIds.length) {
    const error = createError(
      "Los combos no pueden tener promociones por cantidad, solo productos",
      "PROMO_PRODUCT_TYPE_NOT_ALLOWED",
      400
    );
    error.details = { productIds: comboIds };
    throw error;
  }
}

/**
 * Un producto puede estar a lo sumo en una Promo ACTIVA a la vez — evita ambigüedad
 * de qué escalón aplica. Solo se chequea si la promo resultante queda activa.
 */
async function ensureNoActivePromoConflict(tx, tenantId, productIds, { excludePromoId } = {}) {
  const conflict = await tx.promoProduct.findFirst({
    where: {
      tenantId,
      productId: { in: productIds },
      promo: {
        isActive: true,
        ...(excludePromoId != null ? { id: { not: excludePromoId } } : {}),
      },
    },
    select: { productId: true, promoId: true },
  });

  if (conflict) {
    const error = createError(
      "Ese producto ya tiene una promoción activa",
      "PROMO_PRODUCT_ALREADY_LINKED",
      409
    );
    error.details = { productId: conflict.productId, conflictingPromoId: conflict.promoId };
    throw error;
  }
}

const promoInclude = {
  tiers: { orderBy: { minQty: "asc" } },
  products: { include: { product: { select: { id: true, name: true, img: true } } } },
};

export const PromoModel = {
  async getAll({ tenantId, isActive, productId, limit = 10, offset = 0 }) {
    const where = { tenantId };
    if (isActive !== undefined) where.isActive = isActive;
    if (productId !== undefined) where.products = { some: { productId } };

    return prisma.promo.findMany({
      where,
      include: promoInclude,
      orderBy: { id: "desc" },
      take: limit,
      skip: offset,
    });
  },

  async getById({ tenantId, id }) {
    const promo = await prisma.promo.findFirst({
      where: { id, tenantId },
      include: promoInclude,
    });

    if (!promo) {
      throw createError("La promoción no existe", "PROMO_NOT_FOUND", 404);
    }

    return promo;
  },

  async create({ tenantId, name, description, isActive = true, tiers, productIds }) {
    validateTiers(tiers);

    const result = await prisma.$transaction(async (tx) => {
      await validateProducts(tx, tenantId, productIds);
      if (isActive) {
        await ensureNoActivePromoConflict(tx, tenantId, productIds);
      }

      const promo = await tx.promo.create({
        data: { tenantId, name, description: description ?? null, isActive },
      });

      await tx.promoTier.createMany({
        data: tiers.map((t) => ({
          tenantId,
          promoId: promo.id,
          minQty: t.minQty,
          discountPercentage: t.discountPercentage,
        })),
      });
      await tx.promoProduct.createMany({
        data: productIds.map((productId) => ({ tenantId, promoId: promo.id, productId })),
      });

      return tx.promo.findFirst({ where: { id: promo.id }, include: promoInclude });
    });

    await invalidateProductsCache(tenantId);
    return result;
  },

  async edit({ tenantId, id, name, description, isActive, tiers, productIds }) {
    const result = await prisma.$transaction(async (tx) => {
      const promo = await tx.promo.findFirst({
        where: { id, tenantId },
        include: { products: true },
      });

      if (!promo) {
        throw createError("La promoción no existe", "PROMO_NOT_FOUND", 404);
      }

      if (tiers !== undefined) {
        validateTiers(tiers);
      }

      const effectiveProductIds = productIds ?? promo.products.map((p) => p.productId);
      const effectiveIsActive = isActive ?? promo.isActive;

      if (productIds !== undefined) {
        await validateProducts(tx, tenantId, productIds);
      }
      if (effectiveIsActive) {
        await ensureNoActivePromoConflict(tx, tenantId, effectiveProductIds, {
          excludePromoId: id,
        });
      }

      await tx.promo.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description }),
          ...(isActive !== undefined && { isActive }),
        },
      });

      if (tiers !== undefined) {
        await tx.promoTier.deleteMany({ where: { promoId: id } });
        await tx.promoTier.createMany({
          data: tiers.map((t) => ({
            tenantId,
            promoId: id,
            minQty: t.minQty,
            discountPercentage: t.discountPercentage,
          })),
        });
      }

      if (productIds !== undefined) {
        await tx.promoProduct.deleteMany({ where: { promoId: id } });
        await tx.promoProduct.createMany({
          data: productIds.map((productId) => ({ tenantId, promoId: id, productId })),
        });
      }

      return tx.promo.findFirst({ where: { id }, include: promoInclude });
    });

    await invalidateProductsCache(tenantId);
    return result;
  },

  async delete({ tenantId, id }) {
    const promo = await prisma.promo.findFirst({ where: { id, tenantId } });

    if (!promo) {
      throw createError("La promoción no existe", "PROMO_NOT_FOUND", 404);
    }

    const result = await prisma.promo.delete({ where: { id } });
    await invalidateProductsCache(tenantId);
    return result;
  },
};
