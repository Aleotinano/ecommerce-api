import prisma from "../lib/prisma.js";
import { createError } from "../helpers/error.js";
import { resolveProductStock, resolveVariantForProduct } from "../helpers/price.js";
import { validateComboSelection } from "./combos.js";

// Dueño del carrito: userId (autenticado) o guestId (cookie de invitado) — nunca
// ambos ni ninguno, ver constraint CHECK en la migración de Cart. `where` usa el
// índice único correspondiente (tenantId_userId o tenantId_guestId vía userId
// @unique / @@unique([tenantId, guestId])).
function cartOwnerWhere({ tenantId, userId, guestId }) {
  return userId != null ? { userId } : { tenantId_guestId: { tenantId, guestId } };
}

function cartOwnerFilter({ tenantId, userId, guestId }) {
  return userId != null ? { userId, tenantId } : { tenantId, guestId };
}

export const CartModel = {
  async getCart({ tenantId, userId, guestId }) {
    const cart = await prisma.cart.findFirst({
      where: cartOwnerFilter({ tenantId, userId, guestId }),
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
   * Agrega 1 unidad de un producto PRODUCTO al carrito. `variantId` es opcional: si
   * no viene, se resuelve la variante principal (`isDefault`) — así "agregar al
   * carrito" sin abrir un picker sigue andando para un producto sin opciones reales.
   * Para COMBO usar `addCombo`. El `findFirst` antes del create/update (dentro de la
   * misma transacción) da un 409 de negocio legible; el índice único parcial de
   * `CartItem` (ver prisma/schema.prisma) sigue siendo el backstop real contra
   * condiciones de carrera.
   */
  async add({ tenantId, userId, guestId, productId, variantId }) {
    return prisma.$transaction(async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: productId, tenantId },
        include: { variants: true },
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

      const variant = resolveVariantForProduct(product, variantId);
      if (!variant) {
        throw variantId != null
          ? createError("Variante no encontrada", "VARIANT_NOT_FOUND", 404)
          : createError(
              "El producto no tiene una variante disponible",
              "VARIANT_REQUIRED",
              400
            );
      }
      if (!variant.isActive) {
        throw createError("Variante no disponible", "VARIANT_NOT_AVAILABLE", 400);
      }

      const resolvedVariantId = variant.id;

      const cart = await tx.cart.upsert({
        where: cartOwnerWhere({ tenantId, userId, guestId }),
        update: {},
        create: { tenantId, userId, guestId },
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
  async addCombo({ tenantId, userId, guestId, comboProductId, selection }) {
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
        where: cartOwnerWhere({ tenantId, userId, guestId }),
        update: {},
        create: { tenantId, userId, guestId },
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

  async remove({ tenantId, userId, guestId, productId, variantId }) {
    const cart = await prisma.cart.findFirst({
      where: cartOwnerFilter({ tenantId, userId, guestId }),
      select: { id: true },
    });

    if (!cart) {
      throw createError("El carrito está vacío", "EMPTY_CART", 404);
    }

    // Sin `variantId` explícito: resuelve la principal del producto (mismo criterio
    // que `add`). Si el producto es un combo (sin variantes propias), esto no
    // encuentra nada y `resolvedVariantId` queda en null — justo lo que necesita el
    // lookup de abajo para una línea de combo.
    let resolvedVariantId = variantId ?? null;
    if (resolvedVariantId == null) {
      const defaultVariant = await prisma.productVariant.findFirst({
        where: { productId, tenantId, isDefault: true },
        select: { id: true },
      });
      resolvedVariantId = defaultVariant?.id ?? null;
    }

    const item = await prisma.cartItem.findFirst({
      where: { cartId: cart.id, productId, variantId: resolvedVariantId },
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

  async clear({ tenantId, userId, guestId }) {
    const cart = await prisma.cart.findFirst({
      where: cartOwnerFilter({ tenantId, userId, guestId }),
      select: { id: true },
    });

    if (!cart) {
      throw createError("El carrito está vacío", "EMPTY_CART", 404);
    }

    return prisma.cartItem.deleteMany({
      where: { cartId: cart.id },
    });
  },

  /**
   * Fusiona el carrito de invitado (cookie guestId) dentro del Cart del user que
   * acaba de loguearse: reparenta las líneas sin conflicto, suma cantidades cuando
   * el mismo producto+variante ya está en ambos carritos (clampeado a stock), y ante
   * un conflicto de combo (mismo producto, variantId null) se queda con la selección
   * que ya tenía el usuario logueado, descartando la del guest. Se llama desde
   * StoreAuthController.login; si no hay carrito de guest, es un no-op.
   */
  async mergeGuestCartIntoUser({ tenantId, userId, guestId }) {
    return prisma.$transaction(async (tx) => {
      const guestCart = await tx.cart.findUnique({
        where: { tenantId_guestId: { tenantId, guestId } },
        include: { items: { include: { product: { include: { variants: true } } } } },
      });

      if (!guestCart) return;

      if (guestCart.items.length === 0) {
        await tx.cart.delete({ where: { id: guestCart.id } });
        return;
      }

      const userCart = await tx.cart.upsert({
        where: { userId },
        update: {},
        create: { tenantId, userId },
      });

      for (const guestItem of guestCart.items) {
        const existing = await tx.cartItem.findFirst({
          where: {
            cartId: userCart.id,
            productId: guestItem.productId,
            variantId: guestItem.variantId,
          },
        });

        if (!existing) {
          await tx.cartItem.update({
            where: { id: guestItem.id },
            data: { cartId: userCart.id },
          });
          continue;
        }

        if (guestItem.variantId == null) {
          await tx.cartItem.delete({ where: { id: guestItem.id } });
          continue;
        }

        const variant =
          guestItem.product?.variants?.find((v) => v.id === guestItem.variantId) ?? null;
        const stock = resolveProductStock(guestItem.product, variant) ?? 0;
        const mergedQuantity = Math.min(
          existing.quantity + guestItem.quantity,
          Math.max(stock, existing.quantity)
        );

        await tx.cartItem.update({
          where: { id: existing.id },
          data: { quantity: mergedQuantity },
        });
        await tx.cartItem.delete({ where: { id: guestItem.id } });
      }

      await tx.cart.delete({ where: { id: guestCart.id } });
    });
  },
};
