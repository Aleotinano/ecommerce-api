import { createError } from "../helpers/error.js";
import { resolveProductStock, resolveVariantForProduct } from "../helpers/price.js";

const selectionKey = (s) => `${s.productId}::${s.variantId ?? ""}`;

/**
 * Valida la selección de un cliente para UN combo (`comboProduct.type === "COMBO"`)
 * contra su whitelist y devuelve la selección normalizada
 * `[{ productId, variantId, quantity }]` (agrupada, cantidades para UNA unidad de
 * combo). La whitelist tiene dos capas: reglas standalone (`ComboAllowedProduct`
 * con FK null, min/max per-producto, legacy) y reglas por categoría
 * (`ComboAllowedCategory`, min/maxQty = TOTAL DEL GRUPO, con miembros explícitos
 * opcionales — sin miembros, toda la categoría). El mínimo de cada grupo se exige
 * SIEMPRE, aunque la selección no incluya nada de esa categoría. Compartido por
 * `services/cart.js` (agregar al carrito) y `services/orders.js` (`priceItems`,
 * al pasar a orden) para no duplicar la regla.
 *
 * Cada componente elegido es un producto PRODUCTO de la whitelist (nunca COMBO — sin
 * anidamiento). `variantId` es opcional en la selección: si no viene, se resuelve la
 * variante principal (`isDefault`) del componente, igual que en `services/cart.js`.
 *
 * @param {object} p
 * @param {object} p.tx            cliente de transacción de Prisma
 * @param {number} p.tenantId
 * @param {object} p.comboProduct  producto combo (con id, comboMinItems, comboMaxItems)
 * @param {Array}  p.selection     `[{ productId, variantId?, quantity }]`
 * @param {boolean} p.checkStock   si valida stock de cada componente elegido
 */
export async function validateComboSelection({
  tx,
  tenantId,
  comboProduct,
  selection,
  checkStock,
}) {
  if (!Array.isArray(selection) || selection.length === 0) {
    throw createError(
      "Debés elegir productos para el combo",
      "COMBO_SELECTION_REQUIRED",
      400
    );
  }

  if (
    selection.some(
      (s) => !Number.isInteger(s.quantity) || s.quantity <= 0 || !Number.isInteger(s.productId)
    )
  ) {
    throw createError(
      "Cantidad inválida en la selección del combo",
      "COMBO_SELECTION_OUT_OF_RANGE",
      400
    );
  }

  // Agrupa por producto+variante, por si la selección repite la misma línea.
  const grouped = new Map();
  for (const s of selection) {
    const key = selectionKey(s);
    const existing = grouped.get(key);
    grouped.set(key, {
      productId: s.productId,
      variantId: s.variantId ?? null,
      quantity: (existing?.quantity ?? 0) + s.quantity,
    });
  }
  const lines = [...grouped.values()];

  const totalQty = lines.reduce((sum, l) => sum + l.quantity, 0);
  const { comboMinItems, comboMaxItems } = comboProduct;
  if (
    (comboMinItems != null && totalQty < comboMinItems) ||
    (comboMaxItems != null && totalQty > comboMaxItems)
  ) {
    const error = createError(
      "La cantidad elegida no cumple el mínimo/máximo del combo",
      "COMBO_SELECTION_OUT_OF_RANGE",
      400
    );
    error.details = { comboMinItems, comboMaxItems, total: totalQty };
    throw error;
  }

  const productIds = [...new Set(lines.map((l) => l.productId))];
  const products = await tx.product.findMany({
    where: { id: { in: productIds }, tenantId },
    include: { variants: true },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  const [allowed, allowedCategories] = await Promise.all([
    tx.comboAllowedProduct.findMany({
      where: { comboProductId: comboProduct.id, tenantId, isActive: true },
    }),
    tx.comboAllowedCategory.findMany({
      where: { comboProductId: comboProduct.id, tenantId, isActive: true },
    }),
  ]);
  // Las filas de comboAllowedProduct tienen dos sabores (ver schema.prisma):
  // standalone (FK null, regla legacy per-producto con su propio min/max) y MIEMBRO
  // explícito de una regla de categoría (marca pertenencia; la cantidad la gobierna
  // el total del grupo de la regla).
  const standaloneByProduct = new Map(
    allowed
      .filter((a) => a.comboAllowedCategoryId == null)
      .map((a) => [a.allowedProductId, a])
  );
  // Variante FIJADA por producto (`allowedVariantId`, ver schema.prisma). Aplica a los
  // dos sabores de fila, porque tanto una regla standalone como un miembro explícito
  // pueden nombrar una presentación puntual ("el pack lleva la caja x48"). El
  // @@unique([comboProductId, allowedProductId]) garantiza una sola fila por producto,
  // así que alcanza con un Map. Una regla de categoría SIN miembros explícitos no
  // puede fijar variante: no tiene fila donde guardarla, y eso es correcto — "toda la
  // categoría" incluye productos futuros cuyas variantes todavía no existen.
  const pinnedVariantByProduct = new Map(
    allowed
      .filter((a) => a.allowedVariantId != null)
      .map((a) => [a.allowedProductId, a.allowedVariantId])
  );
  const rulesByCategory = new Map(allowedCategories.map((a) => [a.categoryId, a]));
  const ruleById = new Map(allowedCategories.map((a) => [a.id, a]));
  const memberRuleIdByProduct = new Map();
  const memberIdsByRule = new Map();
  for (const a of allowed) {
    if (a.comboAllowedCategoryId == null) continue;
    memberRuleIdByProduct.set(a.allowedProductId, a.comboAllowedCategoryId);
    const set = memberIdsByRule.get(a.comboAllowedCategoryId) ?? new Set();
    set.add(a.allowedProductId);
    memberIdsByRule.set(a.comboAllowedCategoryId, set);
  }

  // Cantidad total por PRODUCTO (sin importar variante).
  const qtyByProduct = new Map();
  for (const line of lines) {
    if (!productMap.has(line.productId)) {
      throw createError("Producto no encontrado", "PRODUCT_NOT_FOUND", 404);
    }
    qtyByProduct.set(line.productId, (qtyByProduct.get(line.productId) ?? 0) + line.quantity);
  }

  // Membership + acumulación por grupo. Regla standalone tiene prioridad y valida
  // per-producto (legacy); su cantidad NO suma al grupo de su categoría (consistente
  // con la expansión de getComboOptions). Ver docs/servicios/dominio/Combos.md.
  const qtyByCategoryRule = new Map();
  for (const [productId, qty] of qtyByProduct) {
    const product = productMap.get(productId);
    const standaloneRule = standaloneByProduct.get(productId);

    if (standaloneRule) {
      if (
        (standaloneRule.minQty && qty < standaloneRule.minQty) ||
        (standaloneRule.maxQty != null && qty > standaloneRule.maxQty)
      ) {
        const error = createError(
          "La cantidad de ese producto no respeta el mínimo/máximo permitido",
          "COMBO_ITEM_QTY_OUT_OF_RANGE",
          400
        );
        error.details = { productId, minQty: standaloneRule.minQty, maxQty: standaloneRule.maxQty };
        throw error;
      }
      continue;
    }

    // Miembro explícito: siempre permitido y suma al grupo de SU regla (aunque el
    // producto haya cambiado de categoría después — consistente con getComboOptions,
    // que expande por filas miembro). Sin fila miembro: cae a la regla de su
    // categoría actual, solo si esa regla no tiene miembros explícitos.
    const memberRule = ruleById.get(memberRuleIdByProduct.get(productId));
    const categoryRule =
      memberRule ??
      (product.categoryId != null ? rulesByCategory.get(product.categoryId) : undefined);
    const members = categoryRule ? memberIdsByRule.get(categoryRule.id) : undefined;
    const isAllowed =
      categoryRule != null && (memberRule != null || members == null || members.size === 0);
    if (!isAllowed) {
      const error = createError(
        "Ese producto no está permitido en este combo",
        "COMBO_PRODUCT_NOT_ALLOWED",
        400
      );
      error.details = { productId };
      throw error;
    }
    qtyByCategoryRule.set(categoryRule.id, (qtyByCategoryRule.get(categoryRule.id) ?? 0) + qty);
  }

  // La cantidad por categoría es el TOTAL DEL GRUPO y se exige para TODAS las reglas,
  // aunque el cliente no haya elegido nada de una ("el combo LLEVA 4 brownies", no es
  // opcional — reglas legacy con minQty 0 no se ven afectadas).
  for (const rule of allowedCategories) {
    const sum = qtyByCategoryRule.get(rule.id) ?? 0;
    if (sum < rule.minQty || (rule.maxQty != null && sum > rule.maxQty)) {
      const error = createError(
        "La cantidad elegida de esa categoría no respeta el mínimo/máximo del grupo",
        "COMBO_ITEM_QTY_OUT_OF_RANGE",
        400
      );
      error.details = {
        categoryId: rule.categoryId,
        minQty: rule.minQty,
        maxQty: rule.maxQty,
        selected: sum,
      };
      throw error;
    }
  }

  const children = [];
  for (const line of lines) {
    const product = productMap.get(line.productId);

    if (product.type === "COMBO") {
      throw createError("No se permiten combos anidados", "COMBO_NESTED_NOT_ALLOWED", 400);
    }
    if (!product.isActive) {
      const error = createError(
        "Producto del combo no disponible",
        "COMBO_PRODUCT_NOT_ALLOWED",
        400
      );
      error.details = { productId: line.productId };
      throw error;
    }

    // Con variante fijada y una línea que no eligió ninguna, se resuelve LA FIJADA en
    // vez de la default: el cliente que dice "quiero Chipá" en un combo que lleva el
    // pack de 4 no tiene por qué nombrar la presentación. Si eligió una explícita, se
    // respeta y se valida abajo.
    const pinnedVariantId = pinnedVariantByProduct.get(line.productId) ?? null;
    const variant = resolveVariantForProduct(product, line.variantId ?? pinnedVariantId);
    if (!variant) {
      throw createError("Variante no encontrada", "VARIANT_NOT_FOUND", 404);
    }
    if (pinnedVariantId != null && variant.id !== pinnedVariantId) {
      const error = createError(
        "Ese producto entra al combo solo en una presentación puntual",
        "COMBO_VARIANT_NOT_ALLOWED",
        400
      );
      error.details = {
        productId: line.productId,
        elegida: variant.id,
        permitida: pinnedVariantId,
      };
      throw error;
    }
    if (!variant.isActive) {
      const error = createError(
        "Producto del combo no disponible",
        "COMBO_PRODUCT_NOT_ALLOWED",
        400
      );
      error.details = { variant: variant.id };
      throw error;
    }

    const stock = resolveProductStock(product, variant);
    if (checkStock && line.quantity > (stock ?? 0)) {
      const error = createError("Stock insuficiente", "INSUFFICIENT_STOCK", 409);
      error.details = {
        productId: line.productId,
        variant: variant?.id ?? null,
        solicitado: line.quantity,
        disponible: stock ?? 0,
      };
      throw error;
    }

    children.push({
      productId: line.productId,
      variantId: variant?.id ?? null,
      quantity: line.quantity,
    });
  }

  return children;
}
