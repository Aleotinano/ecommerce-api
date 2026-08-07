import { ORDER_TRANSITIONS } from "./order-state.js";

/**
 * Catálogo de estados de una orden: **el único lugar donde un estado tiene nombre**.
 *
 * Hasta acá la misma tabla estaba escrita cinco veces —el copy de los emails
 * (`lib/mailer.js`), los mensajes del panel (`controllers/orders.js`), las
 * etiquetas de estadísticas (`services/stats/builders.js`), y una tabla propia en
 * cada uno de los dos frontends—, así que agregar `READY` obligó a tocar cinco
 * archivos y el panel terminaba traduciendo "el código dice PENDING pero mostralo
 * Nueva". Ahora el nombre lo decide el dominio y lo consume todo el mundo, incluidos
 * los fronts vía `GET /order-statuses`.
 *
 * Es un módulo **puro** (sin DB ni red), igual que `services/order-state.js`: se
 * testea sin base y lo puede importar cualquiera.
 *
 * Dos juegos de texto por estado, y no uno, porque el registro es distinto a
 * propósito: quien atiende ve "Nueva" (le entró un pedido), el cliente ve
 * "Pendiente / Recibimos tu pedido" — "Nueva" del lado del cliente no significa
 * nada. Y donde el panel dice "Entregada" el cliente lee "Completada".
 *
 * Los textos de `admin` concuerdan con **"orden"** (femenino), que es el sustantivo
 * de la pantalla y el que ya usaba el panel de estadísticas; los de `customer`,
 * con "tu pedido" / "tu compra".
 */

/**
 * @typedef {object} OrderStatusEntry
 * @property {string} code
 * @property {number|null} position  Lugar en el pipeline; `null` en CANCELLED, que
 *   es la salida lateral y no un paso del camino.
 * @property {boolean} isManual      Si una persona puede llevar la orden a este
 *   estado desde el panel. `NEW` no lo es: es donde nace, y el motor la saca sola.
 * @property {{ label: string, plural: string, message: string }} admin
 *   `message` completa "Orden ___ exitosamente" en las respuestas del backoffice.
 * @property {{ label: string, description: string }} customer
 * @property {{ status: string, message: string }} email  Copy del aviso al cliente.
 *   **Interno**: no sale por HTTP.
 * @property {string} historyNote  Nota por defecto de `OrderStatusHistory` cuando
 *   quien mueve la orden no manda una. **Interno**: vivía en el panel, que tenía que
 *   mandarla en cada PATCH para que el timeline no quedara mudo.
 */

/** @type {Record<string, OrderStatusEntry>} */
export const ORDER_STATUS_CATALOG = {
  NEW: {
    code: "NEW",
    position: 0,
    isManual: false,
    admin: { label: "Nueva", plural: "Nuevas", message: "actualizada" },
    customer: { label: "Pendiente", description: "Recibimos tu pedido" },
    email: {
      status: "pendiente",
      message: "Recibimos tu pedido y está pendiente de procesamiento.",
    },
    historyNote: "Pedido creado",
  },
  PROCESSING: {
    code: "PROCESSING",
    position: 1,
    isManual: true,
    admin: { label: "Preparando", plural: "Preparando", message: "en preparación" },
    customer: { label: "En preparación", description: "Lo estamos preparando" },
    email: {
      status: "en preparación",
      message: "¡Buenas noticias! Estamos preparando tu pedido.",
    },
    historyNote: "Pedido en preparación",
  },
  READY: {
    code: "READY",
    position: 2,
    isManual: true,
    admin: { label: "Lista", plural: "Listas", message: "marcada como lista" },
    customer: { label: "Listo", description: "Tu pedido está listo" },
    email: {
      status: "listo",
      message: "Tu pedido ya está listo. Te avisamos para coordinar la entrega.",
    },
    historyNote: "Pedido listo para retirar/enviar",
  },
  COMPLETED: {
    code: "COMPLETED",
    position: 3,
    isManual: true,
    admin: { label: "Entregada", plural: "Entregadas", message: "entregada" },
    customer: { label: "Completada", description: "Entregado" },
    email: {
      status: "completado",
      message: "Tu pedido fue completado. ¡Gracias por tu compra!",
    },
    historyNote: "Pedido entregado",
  },
  CANCELLED: {
    code: "CANCELLED",
    // Fuera del pipeline: se llega desde cualquier punto y no se sigue a ningún lado.
    position: null,
    isManual: true,
    admin: { label: "Cancelada", plural: "Canceladas", message: "cancelada" },
    customer: { label: "Cancelada", description: "El pedido se canceló" },
    email: {
      status: "cancelado",
      message: "Tu pedido fue cancelado. Si tenés dudas, contactanos.",
    },
    historyNote: "Pedido cancelado",
  },
};

/**
 * Los códigos en orden de flujo, con CANCELLED al final. Es lo que consumen los
 * listados y la distribución de [[Estadísticas]]: un estado que falte acá suma al
 * total pero no aparece en el panel, y los porcentajes dejan de cerrar en 100.
 *
 * **Congelado**: el orden ES el dato (define el pipeline), y un `.sort()` de un
 * consumidor lo reordenaría para todo el proceso — pasó en el primer test que se
 * escribió de este módulo. Frozen hace que ese error tire TypeError en vez de
 * dejar el panel mostrando "Canceladas" como primer paso.
 */
export const ORDER_STATUS_CODES = Object.freeze(Object.keys(ORDER_STATUS_CATALOG));

/**
 * Nunca devuelve `undefined`: un estado que el catálogo no conozca sale con el
 * código como texto en vez de romper la respuesta entera. Que se vea feo en
 * pantalla es preferible a que un enum nuevo tumbe el listado de órdenes.
 */
export function getStatusMeta(code) {
  return (
    ORDER_STATUS_CATALOG[code] ?? {
      code,
      position: null,
      isManual: false,
      admin: { label: code, plural: code, message: "actualizada" },
      customer: { label: code, description: "" },
      email: { status: code, message: `El estado de tu pedido cambió a ${code}.` },
      historyNote: `Estado actualizado a ${code}`,
    }
  );
}

/**
 * Proyección pública del catálogo (`GET /order-statuses`).
 *
 * `email` e `historyNote` **no salen**: son copy interno de un canal que el front
 * no dibuja. `transitions` no se declara en este módulo —sale de
 * `ORDER_TRANSITIONS`, que ya es la fuente de qué se puede mover a dónde— así que
 * el panel puede armar el pipeline sin volver a escribir las reglas.
 */
export function toPublicStatus(entry) {
  return {
    code: entry.code,
    position: entry.position,
    isManual: entry.isManual,
    transitions: ORDER_TRANSITIONS[entry.code] ?? [],
    admin: entry.admin,
    customer: entry.customer,
  };
}

export function listPublicStatuses() {
  return ORDER_STATUS_CODES.map((code) =>
    toPublicStatus(ORDER_STATUS_CATALOG[code])
  );
}
