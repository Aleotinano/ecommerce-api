import prisma from "../lib/prisma.js";
import { createError } from "../helpers/error.js";
import { validateComboSelection } from "./combos.js";

export const CartModel = {
  async getCart({ tenantId, id }) {
    const cart = await prisma.cart.findFirst({
      where: { userId: id, tenantId },
      include: {
        items: {
          include: {
            variant: {
              include: { product: true },
            },
          },
        },
      },
    });

    if (!cart) {
      return { createdAt: null, updatedAt: null, items: [] };
    }

    return cart;
  },

  async add({ tenantId, id, variantId }) {
    return prisma.$transaction(async (tx) => {
      const variant = await tx.productVariant.findFirst({
        where: { id: variantId, tenantId },
        include: { product: true },
      });

      if (!variant) {
        throw createError("Variante no encontrada", "VARIANT_NOT_FOUND", 404);
      }

      if (!variant.isActive || !variant.product?.isActive) {
        throw createError(
          "Variante no disponible",
          "VARIANT_NOT_AVAILABLE",
          400
        );
      }

      const cart = await tx.cart.upsert({
        where: { userId: id },
        update: {},
        create: { userId: id, tenantId },
      });

      const existingItem = await tx.cartItem.findUnique({
        where: { cartId_variantId: { cartId: cart.id, variantId } },
      });

      const currentQuantity = existingItem?.quantity ?? 0;

      if (currentQuantity + 1 > variant.stock) {
        throw createError("Stock insuficiente", "INSUFFICIENT_STOCK", 409);
      }

      return tx.cartItem.upsert({
        where: { cartId_variantId: { cartId: cart.id, variantId } },
        update: { quantity: { increment: 1 } },
        create: { cartId: cart.id, variantId, quantity: 1 },
        include: {
          variant: { include: { product: true } },
        },
      });
    });
  },

  /**
   * Agrega un combo al carrito con la selección de componentes elegida por el
   * cliente. La fila del carrito es UNA sola `CartItem` (variantId = variante
   * default del producto-combo); la selección se re-valida server-side contra
   * la whitelist (ver services/combos.js) y se guarda serializada en
   * `comboSelection` — nunca se confía en ella al leerla, se vuelve a validar
   * al pasar a orden. Volver a llamar esto reemplaza la selección anterior.
   */
  async addCombo({ tenantId, id, comboVariantId, selection }) {
    return prisma.$transaction(async (tx) => {
      const comboVariant = await tx.productVariant.findFirst({
        where: { id: comboVariantId, tenantId },
        include: { product: true },
      });

      if (!comboVariant) {
        throw createError("Variante no encontrada", "VARIANT_NOT_FOUND", 404);
      }
      if (!comboVariant.isActive || !comboVariant.product?.isActive) {
        throw createError(
          "Variante no disponible",
          "VARIANT_NOT_AVAILABLE",
          400
        );
      }
      if (!comboVariant.product.isCombo) {
        throw createError("El producto no es un combo", "PRODUCT_NOT_COMBO", 400);
      }

      const children = await validateComboSelection({
        tx,
        tenantId,
        comboProduct: comboVariant.product,
        selection,
        checkStock: true,
      });

      const cart = await tx.cart.upsert({
        where: { userId: id },
        update: {},
        create: { userId: id, tenantId },
      });

      const existingItem = await tx.cartItem.findUnique({
        where: { cartId_variantId: { cartId: cart.id, variantId: comboVariantId } },
      });
      const currentQuantity = existingItem?.quantity ?? 0;

      return tx.cartItem.upsert({
        where: { cartId_variantId: { cartId: cart.id, variantId: comboVariantId } },
        update: { quantity: currentQuantity + 1, comboSelection: children },
        create: {
          cartId: cart.id,
          variantId: comboVariantId,
          quantity: 1,
          comboSelection: children,
        },
        include: { variant: { include: { product: true } } },
      });
    });
  },

  async remove({ tenantId, id, variantId }) {
    const cart = await prisma.cart.findFirst({
      where: { userId: id, tenantId },
      select: { id: true },
    });

    if (!cart) {
      throw createError("El carrito está vacío", "EMPTY_CART", 404);
    }

    const cartItem = await prisma.cartItem.findUnique({
      where: { cartId_variantId: { cartId: cart.id, variantId } },
    });

    if (!cartItem) {
      throw createError(
        "No se encontró la variante en el carrito",
        "VARIANT_NOT_IN_CART",
        404
      );
    }

    if (cartItem.quantity === 1) {
      await prisma.cartItem.delete({
        where: { cartId_variantId: { cartId: cart.id, variantId } },
      });

      return { deleted: true };
    }

    const updated = await prisma.cartItem.update({
      where: { cartId_variantId: { cartId: cart.id, variantId } },
      data: { quantity: { decrement: 1 } },
    });

    return { deleted: false, cartItem: updated };
  },

  async clear({ tenantId, id }) {
    const cart = await prisma.cart.findFirst({
      where: { userId: id, tenantId },
      select: { id: true },
    });

    if (!cart) {
      throw createError("El carrito está vacío", "EMPTY_CART", 404);
    }

    return prisma.cartItem.deleteMany({
      where: { cartId: cart.id },
    });
  },
};
