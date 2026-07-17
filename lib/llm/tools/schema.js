/**
 * Definicion NEUTRA de las tools del chatbot, en un formato propio
 * provider-agnostico: { name, description, parameters }.
 *
 * `parameters` usa un JSON-schema minimo (type/properties/required) que cada
 * provider traduce a su formato (Gemini: functionDeclarations; Anthropic:
 * input_schema). Esta es la UNICA fuente de verdad de las tools: el loop, los
 * handlers y el rate limit no dependen del provider.
 *
 * SEGURIDAD: ninguna tool declara `tenantId`. El scope de tenant se inyecta
 * server-side en los handlers (services/chat/tools.js), nunca lo provee el LLM.
 */

/**
 * Nombre de la tool que solo se ofrece a clientes logueados. `buildToolContext`
 * la filtra de la lista cuando no hay `user`, asi un anonimo nunca puede pedir
 * el estado de una orden.
 */
export const AUTHENTICATED_TOOLS = new Set(["getMyOrderStatus"]);

/**
 * Tools que solo se ofrecen cuando hay un CANAL con identidad de cliente (hoy:
 * WhatsApp, donde el cliente es el wa_id y hay historial). `buildToolContext` las
 * filtra salvo que el canal lo habilite. `createDraftOrder` es la UNICA tool de
 * escritura del bot: aun asi no decide plata ni tenant (todo server-side).
 */
export const CHANNEL_ORDER_TOOLS = new Set(["createDraftOrder"]);

/** Specs neutras de todas las tools posibles del bot. */
export const TOOL_DEFINITIONS = [
  {
    name: "searchProducts",
    description:
      "Busca productos del catalogo de la tienda por texto y/o categoria. " +
      "Devuelve una lista breve con nombre, precio y si hay stock. Usala cuando " +
      "el cliente pregunta que hay disponible o busca algo por nombre/tipo.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Texto a buscar en el nombre del producto (ej: 'remera negra').",
        },
        categoryId: {
          type: "integer",
          description:
            "ID de categoria para acotar la busqueda (de listCategories).",
        },
      },
      required: [],
    },
  },
  {
    name: "getProductDetail",
    description:
      "Trae el detalle de un producto puntual: descripcion, precio y sus " +
      "variantes (con sus atributos, ej: color/talle o sabor) y disponibilidad. " +
      "Usala cuando el cliente quiere mas info de un producto concreto.",
    parameters: {
      type: "object",
      properties: {
        productId: {
          type: "integer",
          description: "ID del producto (de searchProducts).",
        },
      },
      required: ["productId"],
    },
  },
  {
    name: "checkAvailability",
    description:
      "Verifica si hay stock de un producto, opcionalmente para una variante " +
      "puntual (por sus atributos). Usala cuando el cliente pregunta si algo " +
      "esta disponible.",
    parameters: {
      type: "object",
      properties: {
        productId: {
          type: "integer",
          description: "ID del producto.",
        },
        attributes: {
          type: "object",
          description:
            "Pares atributo->valor de la variante a verificar (opcional), ej: " +
            '{"color":"rojo","talle":"M"} o {"sabor":"chocolate"}. Usa las ' +
            "claves que devuelve el detalle del producto.",
        },
      },
      required: ["productId"],
    },
  },
  {
    name: "listCategories",
    description:
      "Lista las categorias de la tienda (arbol). Usala para orientar al " +
      "cliente sobre que tipos de productos hay o para acotar una busqueda.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "getMyOrderStatus",
    description:
      "Devuelve el estado del pedido del cliente logueado. Solo disponible si " +
      "el cliente inicio sesion. Usala cuando pregunta por el estado de SU pedido.",
    parameters: {
      type: "object",
      properties: {
        orderId: {
          type: "integer",
          description: "ID del pedido del cliente.",
        },
      },
      required: ["orderId"],
    },
  },
  {
    name: "createDraftOrder",
    description:
      "Crea un pedido BORRADOR con los productos y cantidades que el cliente " +
      "confirmo. Usala SOLO cuando el cliente ya decidio que quiere comprar y " +
      "confirmaste producto(s) y cantidad(es). Vos solo proponen productId y " +
      "cantidad: el sistema valida el catalogo, calcula el precio y el total, y " +
      "un humano revisa el pedido despues. NO prometas precios finales ni montos " +
      "de sena: los fija el sistema. Si un producto tiene variantes, incluí sus " +
      "atributos (ej: color/talle o sabor) para identificar la correcta.",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "Productos y cantidades a pedir.",
          items: {
            type: "object",
            properties: {
              productId: {
                type: "integer",
                description: "ID del producto (de searchProducts).",
              },
              quantity: {
                type: "integer",
                description: "Cantidad (entero positivo).",
              },
              attributes: {
                type: "object",
                description:
                  "Pares atributo->valor de la variante (si aplica), ej: " +
                  '{"color":"rojo","talle":"M"} o {"sabor":"chocolate"}. Usa ' +
                  "las claves que devuelve el detalle del producto.",
              },
              note: {
                type: "string",
                description:
                  "Observacion libre de este producto (ej. \"sin nueces\", " +
                  "\"dedicatoria: Juan\", una eleccion de sabor de un combo). " +
                  "Maximo 150 caracteres.",
              },
            },
            required: ["productId", "quantity"],
          },
        },
      },
      required: ["items"],
    },
  },
];
