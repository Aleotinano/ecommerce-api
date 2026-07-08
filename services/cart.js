import prisma from "../lib/prisma.js";
import { createError } from "../helpers/error.js";
import { resolveProductStock } from "../helpers/price.js";
import { validateComboSelection } from "./combos.js";

export const CartModel = {
  async getCart({ tenantId, id }) {
    const cart = await prisma.cart.findFirst({
      where: { userId: id, tenantId },
      include: {
        items: {
          include: {
            product: true,
            variant: true,
          },
        },
      },
    });

    if (!cart) {
      return { createdAt: null, updatedAt: null, items: [] };
    }

    return cart;
  },

  /**
   * Agrega 1 unidad de un producto UNIDAD/VARIANTE al carrito. `variantId` es
   * obligatorio si el producto es VARIANTE, se ignora si es UNIDAD. Para COMBO usar
   * `addCombo`. El `findFirst` antes del create/update (dentro de la misma
   * transacción) da un 409 de negocio legible; el índice único parcial de
   * `CartItem` (ver prisma/schema.prisma) sigue siendo el backstop real contra
   * condiciones de carrera.
   */
  async add({ tenantId, id, productId, variantId }) {
    return prisma.$transaction(async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: productId, tenantId },
        include: { variants: variantId != null ? { where: { id: variantId } } : false },
      });

      if (!product) {
        throw createError("Producto no encontrado", "PRODUCT_NOT_FOUND", 404);
      }
      if (!product.isActive) {
        throw createError("Producto no disponible", "PRODUCT_NOT_AVAILABLE", 400);
      }
      if (product.type === "COMBO") {
        throw createError(
          "Usá el endpoint de combos para agregar este producto",
          "PRODUCT_IS_COMBO",
          400
        );
      }

      let variant = null;
      if (product.type === "VARIANTE") {
        if (variantId == null) {
          throw createError("Falta indicar la variante", "VARIANT_REQUIRED", 400);
        }
        variant = product.variants?.[0] ?? null;
        if (!variant) {
          throw createError("Variante no encontrada", "VARIANT_NOT_FOUND", 404);
        }
        if (!variant.isActive) {
          throw createError("Variante no disponible", "VARIANT_NOT_AVAILABLE", 400);
        }
      }

      const resolvedVariantId = product.type === "VARIANTE" ? variant.id : null;

      const cart = await tx.cart.upsert({
        where: { userId: id },
        update: {},
        create: { userId: id, tenantId },
      });

      const existingItem = await tx.cartItem.findFirst({
        where: { cartId: cart.id, productId, variantId: resolvedVariantId },
      });

      const currentQuantity = existingItem?.quantity ?? 0;
      const stock = resolveProductStock(product, variant) ?? 0;

      if (currentQuantity + 1 > stock) {
        throw createError("Stock insuficiente", "INSUFFICIENT_STOCK", 409);
      }

      if (existingItem) {
        return tx.cartItem.update({
          where: { id: existingItem.id },
          data: { quantity: { increment: 1 } },
          include: { product: true, variant: true },
        });
      }

      return tx.cartItem.create({
        data: { cartId: cart.id, productId, variantId: resolvedVariantId, quantity: 1 },
        include: { product: true, variant: true },
      });
    });
  },

  /**
   * Agrega un combo al carrito con la selección de componentes elegida por el
   * cliente. La fila del carrito es UNA sola `CartItem` (variantId siempre null —
   * un combo no tiene variante); la selección se re-valida server-side contra la
   * whitelist (ver services/combos.js) y se guarda serializada en `comboSelection`
   * — nunca se confía en ella al leerla, se vuelve a validar al pasar a orden.
   * Volver a llamar esto reemplaza la selección anterior.
   */
  async addCombo({ tenantId, id, comboProductId, selection }) {
    return prisma.$transaction(async (tx) => {
      const comboProduct = await tx.product.findFirst({
        where: { id: comboProductId, tenantId },
      });

      if (!comboProduct) {
        throw createError("Producto no encontrado", "PRODUCT_NOT_FOUND", 404);
      }
      if (!comboProduct.isActive) {
        throw createError("Producto no disponible", "PRODUCT_NOT_AVAILABLE", 400);
      }
      if (comboProduct.type !== "COMBO") {
        throw createError("El producto no es un combo", "PRODUCT_NOT_COMBO", 400);
      }

      const children = await validateComboSelection({
        tx,
        tenantId,
        comboProduct,
        selection,
        checkStock: true,
      });

      const cart = await tx.cart.upsert({
        where: { userId: id },
        update: {},
        create: { userId: id, tenantId },
      });

      const existingItem = await tx.cartItem.findFirst({
        where: { cartId: cart.id, productId: comboProductId, variantId: null },
      });
      const currentQuantity = existingItem?.quantity ?? 0;

      if (existingItem) {
        return tx.cartItem.update({
          where: { id: existingItem.id },
          data: { quantity: currentQuantity + 1, comboSelection: children },
          include: { product: true },
        });
      }

      return tx.cartItem.create({
        data: {
          cartId: cart.id,
          productId: comboProductId,
          variantId: null,
          quantity: 1,
          comboSelection: children,
        },
        include: { product: true },
      });
    });
  },

  async remove({ tenantId, id, productId, variantId }) {
    const cart = await prisma.cart.findFirst({
      where: { userId: id, tenantId },
      select: { id: true },
    });

    if (!cart) {
      throw createError("El carrito está vacío", "EMPTY_CART", 404);
    }

    const item = await prisma.cartItem.findFirst({
      where: { cartId: cart.id, productId, variantId: variantId ?? null },
    });

    if (!item) {
      throw createError(
        "No se encontró el producto en el carrito",
        "PRODUCT_NOT_IN_CART",
        404
      );
    }

    if (item.quantity === 1) {
      await prisma.cartItem.delete({ where: { id: item.id } });
      return { deleted: true };
    }

    const updated = await prisma.cartItem.update({
      where: { id: item.id },
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
