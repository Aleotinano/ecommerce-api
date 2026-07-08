/**
 * Handlers de las tools del chatbot. AQUI vive la seguridad multi-tenant:
 *
 *  - `tenantId` y `user` se toman del CONTEXTO DEL SERVIDOR (closure), nunca de
 *    los argumentos que provee el LLM. El modelo solo elige filtros de dominio
 *    (query, productId, color, size). Asi un prompt no puede saltar de tenant.
 *  - Casi todas las tools son READ-ONLY. La UNICA excepcion de escritura es
 *    `createDraftOrder` (crea un pedido BORRADOR): aun asi el LLM solo propone
 *    productId + cantidad; el server resuelve precio, total, sena y tenant, y la
 *    orden nace SIN revisar (un humano la valida). El bot no puede tocar plata
 *    ni `paymentStatus`: es una propiedad de seguridad, no un olvido.
 *  - Cada tool devuelve una VISTA LIMITADA, nunca el objeto Prisma crudo: jamas
 *    se exponen `sku`, `imgPublicId` ni ids/estructura interna sensible.
 *  - `getMyOrderStatus` solo se ofrece (y ejecuta) si hay cliente logueado.
 *  - `createDraftOrder` solo se ofrece si hay un CANAL con identidad de cliente
 *    (hoy WhatsApp, donde el cliente es el wa_id y hay historial).
 *  - Respeta `TenantConfig.showOutOfStock`: si es false, oculta productos y
 *    variantes sin stock.
 *  - Combos (`product.type === "COMBO"`): el bot todavía no los vende — se
 *    listan/describen, pero `createDraftOrder` los rechaza con un mensaje
 *    amigable. Ver docs/servicios/dominio/Combos.md.
 */
import { ProductModel } from "../productos.js";
import { CategoryModel } from "../categories.js";
import { OrderModel } from "../orders.js";
import { getProductPrice, resolveProductStock } from "../../helpers/price.js";
import {
  TOOL_DEFINITIONS,
  AUTHENTICATED_TOOLS,
  CHANNEL_ORDER_TOOLS,
} from "../../lib/llm/tools/schema.js";

const SEARCH_LIMIT = 8;

/** Cuántos turnos de conversación guardamos como contexto de la orden del bot. */
const CONTEXT_TURNS = 12;

/** Compara color/talle: `b` nulo matchea cualquiera (filtro no especificado). */
const variantMatches = (a, b) =>
  b == null || String(a ?? "").toLowerCase() === String(b).toLowerCase();

/**
 * Arma el snapshot de conversación que se guarda en la orden creada por el bot.
 * El historial vive en Redis con TTL: la orden tiene que recordar su contexto.
 * Texto plano, acotado a los últimos turnos + el mensaje que cerró la compra.
 */
const buildCreationContext = (history = [], message = "") => {
  const turns = [...history.slice(-CONTEXT_TURNS)];
  if (message) turns.push({ role: "user", content: message });
  const lines = turns
    .filter((t) => t && typeof t.content === "string" && t.content.trim())
    .map((t) => `${t.role === "assistant" ? "Asistente" : "Cliente"}: ${t.content.trim()}`);
  return lines.join("\n").slice(0, 4000) || null;
};

/**
 * ¿Hay algo para vender de este producto? VARIANTE mira si alguna variante activa
 * tiene stock; UNIDAD mira `Product.stock`. COMBO no tiene stock propio — se
 * reporta siempre disponible en v1 (el bot igual no lo vende, ver `createDraftOrder`).
 */
const hasStock = (product) => {
  if (product.type === "VARIANTE") {
    return (product.variants ?? []).some((v) => v.isActive && v.stock > 0);
  }
  if (product.type === "UNIDAD") {
    return (resolveProductStock(product, null) ?? 0) > 0;
  }
  return true;
};

/**
 * Precio para listados (sin variante puntual elegida todavía): UNIDAD/COMBO usan
 * `Product.price` directo; VARIANTE muestra el precio de la primera variante con
 * precio propio (referencial — el precio real se resuelve por variante elegida).
 */
const effectiveProductPrice = (product) => {
  if (product.type === "VARIANTE") {
    const priced = (product.variants ?? []).find((v) => v.price != null);
    return priced?.price ?? null;
  }
  return product.price ?? null;
};

/** Carga un mapa id->nombre de categorias del tenant (para etiquetar productos). */
const loadCategoryNames = async (tenantId) => {
  const categories = await CategoryModel.getAll({ tenantId });
  return new Map(categories.map((c) => [c.id, c.name]));
};

/** Da forma legible al arbol de categorias, sin filtrar campos sensibles. */
const toCategoryView = (nodes = []) =>
  nodes.map((c) => ({
    id: c.id,
    name: c.name,
    ...(c.children?.length ? { subcategorias: toCategoryView(c.children) } : {}),
  }));

/**
 * Construye el contexto de tools para un request: la lista de specs que se le
 * ofrece al LLM (filtrando las de cliente logueado si es anonimo) y el ejecutor
 * `executeTool` que corre el handler con el tenant/user inyectados server-side.
 */
export const buildToolContext = ({ tenantId, user, config, channel }) => {
  const showOutOfStock = config?.showOutOfStock ?? false;
  // Las tools de pedido (escritura) solo se habilitan con un canal con identidad
  // de cliente. Hoy: WhatsApp (el cliente es el wa_id y hay historial).
  const orderToolsEnabled = channel?.kind === "whatsapp";

  const tools = TOOL_DEFINITIONS.filter((t) => {
    if (AUTHENTICATED_TOOLS.has(t.name) && !user) return false;
    if (CHANNEL_ORDER_TOOLS.has(t.name) && !orderToolsEnabled) return false;
    return true;
  });

  const handlers = {
    async searchProducts({ query, categoryId } = {}) {
      const products = await ProductModel.getAll({
        tenantId,
        name: typeof query === "string" && query.trim() ? query.trim() : undefined,
        categoryId: Number.isInteger(categoryId) ? categoryId : undefined,
        limit: SEARCH_LIMIT,
        offset: 0,
      });

      const categoryNames = await loadCategoryNames(tenantId);

      const visible = showOutOfStock
        ? products
        : products.filter(hasStock);

      const items = visible.map((p) => ({
        id: p.id,
        name: p.name,
        precio: effectiveProductPrice(p),
        categoria: p.categoryId != null ? categoryNames.get(p.categoryId) ?? null : null,
        hayStock: hasStock(p),
      }));

      return { cantidad: items.length, productos: items };
    },

    async getProductDetail({ productId } = {}) {
      if (!Number.isInteger(productId)) {
        return { error: "Falta el identificador del producto." };
      }

      const product = await ProductModel.getById({ tenantId, id: productId });

      if (product.type !== "VARIANTE") {
        const disponible = hasStock(product);
        if (!disponible && !showOutOfStock) {
          return {
            name: product.name,
            description: product.description ?? null,
            precio: effectiveProductPrice(product),
            disponible: false,
          };
        }
        return {
          name: product.name,
          description: product.description ?? null,
          precio: effectiveProductPrice(product),
          disponible,
        };
      }

      let variantes = (product.variants ?? []).map((v) => ({
        color: v.color ?? null,
        size: v.size ?? null,
        precio: getProductPrice(v, product),
        disponible: v.stock > 0,
      }));

      if (!showOutOfStock) {
        variantes = variantes.filter((v) => v.disponible);
      }

      return {
        name: product.name,
        description: product.description ?? null,
        precio: effectiveProductPrice(product),
        variantes,
      };
    },

    async checkAvailability({ productId, color, size } = {}) {
      if (!Number.isInteger(productId)) {
        return { error: "Falta el identificador del producto." };
      }

      const product = await ProductModel.getById({ tenantId, id: productId });

      if (product.type !== "VARIANTE") {
        const stock = resolveProductStock(product, null);
        const disponible = product.type === "COMBO" ? true : (stock ?? 0) > 0;
        if (disponible || showOutOfStock) {
          return stock != null ? { disponible, stock } : { disponible };
        }
        return { disponible };
      }

      const variants = product.variants ?? [];
      const eq = (a, b) =>
        b == null || String(a ?? "").toLowerCase() === String(b).toLowerCase();

      const matches = variants.filter(
        (v) => eq(v.color, color) && eq(v.size, size)
      );

      // Sin variantes que matcheen el filtro pedido.
      if (!matches.length) {
        return { disponible: false };
      }

      const stock = matches.reduce((sum, v) => sum + Math.max(0, v.stock), 0);
      const disponible = stock > 0;

      // Mostramos el stock solo cuando aporta (hay unidades) o el tenant permite
      // exponer productos sin stock.
      if (disponible || showOutOfStock) {
        return { disponible, stock };
      }
      return { disponible };
    },

    async listCategories() {
      const tree = await CategoryModel.getTree({ tenantId });
      return { categorias: toCategoryView(tree) };
    },

    async getMyOrderStatus({ orderId } = {}) {
      // Defensa en profundidad: aunque la tool no se ofrece a anonimos, nunca
      // ejecutamos sin user. El scope es por user.id Y tenantId.
      if (!user) {
        return { error: "Para consultar pedidos hay que iniciar sesion." };
      }
      if (!Number.isInteger(orderId)) {
        return { error: "Falta el numero de pedido." };
      }

      try {
        const order = await OrderModel.getUserOrderById({
          tenantId,
          userId: user.id,
          orderId,
        });

        return {
          estado: order.status,
          total: order.total,
          creada: order.createdAt,
          items: (order.orderItems ?? []).map((it) => ({
            producto: it.product?.name ?? null,
            cantidad: it.quantity,
          })),
        };
      } catch (err) {
        if (err.code === "ORDER_NOT_FOUND") {
          return { error: "No encontramos un pedido tuyo con ese numero." };
        }
        throw err;
      }
    },

    async createDraftOrder({ items } = {}) {
      // Defensa en profundidad: aunque la tool no se ofrece sin canal, nunca
      // creamos un pedido sin identidad de cliente.
      if (!orderToolsEnabled) {
        return { error: "No puedo registrar pedidos en este canal." };
      }
      if (!Array.isArray(items) || items.length === 0) {
        return { error: "Decime al menos un producto y su cantidad." };
      }

      // Resolvemos productId(+color/size) -> { productId, variantId? } server-side,
      // scopeado al tenant. El bot solo propone; el server valida catalogo y
      // desambigua. VARIANTE exige matchear una única variante; UNIDAD no necesita
      // variante en absoluto.
      const resolved = [];
      for (const raw of items) {
        const { productId, quantity, color, size, note } = raw ?? {};

        if (!Number.isInteger(productId)) {
          return { error: "Falta el identificador de algun producto." };
        }
        if (!Number.isInteger(quantity) || quantity <= 0) {
          return {
            error: "La cantidad de cada producto debe ser un entero positivo.",
          };
        }

        let product;
        try {
          product = await ProductModel.getById({ tenantId, id: productId });
        } catch {
          return { error: `No encontre el producto ${productId}.` };
        }

        // Combos: el bot todavía no arma combos (requiere elegir componentes
        // dentro de un min/max) — se coordina por otro canal. Ver [[Combos]].
        if (product.type === "COMBO") {
          return {
            error: `"${product.name}" es un combo armable — por ahora esos se arman en el local, contactanos para coordinarlo.`,
          };
        }

        const noteValue = typeof note === "string" ? note.slice(0, 150) : null;

        if (product.type === "UNIDAD") {
          resolved.push({ productId, quantity, note: noteValue });
          continue;
        }

        const variants = product.variants ?? [];
        const candidates = variants.filter(
          (v) =>
            variantMatches(v.color, color) && variantMatches(v.size, size)
        );

        if (!candidates.length) {
          return { error: `No encontre esa variante de "${product.name}".` };
        }
        if (candidates.length > 1) {
          return {
            error: `"${product.name}" tiene varias variantes; indicame color y/o talle.`,
          };
        }

        resolved.push({
          productId,
          variantId: candidates[0].id,
          quantity,
          note: noteValue,
        });
      }

      try {
        const order = await OrderModel.createDraft({
          tenantId,
          items: resolved,
          contactPhone: channel.waId ?? null,
          contactName: channel.contactName ?? null,
          creationContext: buildCreationContext(channel.history, channel.message),
        });

        return {
          created: true,
          pedido: order.id,
          total: order.total,
          requiereSena: order.requiresDeposit,
          sena: order.depositAmount,
        };
      } catch (err) {
        if (err.code === "PRODUCT_NO_PRICE") {
          return { error: "Alguno de los productos no tiene precio cargado." };
        }
        if (
          [
            "PRODUCT_NOT_AVAILABLE",
            "VARIANT_NOT_AVAILABLE",
            "VARIANT_NOT_FOUND",
          ].includes(err.code)
        ) {
          return { error: "Alguno de los productos ya no esta disponible." };
        }
        throw err;
      }
    },
  };

  const executeTool = async (name, args) => {
    const handler = handlers[name];
    // Una tool no ofrecida (ej: getMyOrderStatus a un anonimo) nunca se ejecuta.
    if (!handler || !tools.some((t) => t.name === name)) {
      return { error: "Esa accion no esta disponible." };
    }
    return handler(args ?? {});
  };

  return { tools, executeTool };
};
