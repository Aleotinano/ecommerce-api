import { createError } from "../helpers/error.js";
import { TERMINAL_STATUSES } from "./order-state.js";

/**
 * Archivado de órdenes: sacarlas del tablero **sin sacarlas de la base**.
 *
 * El problema que resuelve: el tablero del backoffice agrupa por estado y no corta
 * por fecha, así que "Entregadas" y "Canceladas" crecen para siempre y a los pocos
 * días la pantalla deja de contestar la única pregunta que se le hace cada mañana
 * ("¿qué tengo que hacer hoy?").
 *
 * Dos decisiones que definen todo el módulo:
 *
 *  - **El "día" es el turno de caja**, no la medianoche. `CashRegisterSession` ya es
 *    un turno explícito (apertura → cierre) que existe, según su propio comentario en
 *    el schema, para no tener que definir "hoy" peleándose con las zonas horarias.
 *    Un corte de medianoche sería una segunda definición de lo mismo, peor. Cerrar
 *    el turno cierra el día y archiva.
 *  - **Solo se archiva lo terminal.** Una orden abierta no se esconde nunca, por
 *    vieja que sea: esconderla es exactamente cómo se pierde un pedido, y que se vea
 *    vieja en el tablero ES la alarma.
 *
 * Vive en su propio módulo y no en `services/orders.js` porque lo llama el cierre de
 * caja: `orders.js` ya importa de `cash-register.js` (`recordOrderPayments`), y la
 * importación de vuelta cerraría el ciclo. Acá no depende de ninguno de los dos.
 */

/**
 * Los estados desde los que se puede archivar. Sale de `TERMINAL_STATUSES`, que a
 * su vez sale de `ORDER_TRANSITIONS`: archivable = estado del que no se sale.
 */
export const ARCHIVABLE_STATUSES = TERMINAL_STATUSES;

export function isArchivable(status) {
  return ARCHIVABLE_STATUSES.includes(status);
}

/**
 * Archiva en bloque las órdenes terminales todavía visibles del tenant.
 *
 * **Sin corte por fecha en el `where`, y es a propósito**: al cerrar un turno, todo
 * lo terminal que sigue sin archivar es de ese turno por definición —lo anterior se
 * archivó en el cierre anterior—. El efecto secundario es deseado: el primer cierre
 * después de instalar esto barre de una todo lo terminal acumulado desde siempre.
 *
 * Recibe el `tx` del caller porque el cierre de caja corre en transacción: si el
 * arqueo se cae, las órdenes no pueden haber quedado archivadas por un turno que
 * nunca se cerró.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {object} p
 * @param {number}      p.tenantId
 * @param {number}      p.sessionId  Turno que se está cerrando.
 * @param {number|null} [p.actorId]  Null cuando cierra el sistema (turno vencido).
 * @param {Date}        [p.at]       Se pasa el `closedAt` del turno para que el
 *   sello de la orden y el del arqueo digan la misma hora.
 * @returns {Promise<number>} cuántas se archivaron
 */
export async function archiveTerminalOrders(
  tx,
  { tenantId, sessionId, actorId = null, at = new Date() }
) {
  const { count } = await tx.order.updateMany({
    where: {
      tenantId,
      archivedAt: null,
      status: { in: ARCHIVABLE_STATUSES },
    },
    data: { archivedAt: at, archivedById: actorId, cashSessionId: sessionId },
  });

  return count;
}

/**
 * Los estados de pago con los que una orden ENTREGADA se da por cobrada. Todo lo
 * demás en una COMPLETED es plata que quedó afuera y que el cierre tiene que decir
 * en voz alta antes de que alguien firme el arqueo.
 */
const SETTLED_PAYMENT_STATUSES = ["PAID_IN_FULL", "REFUNDED"];

/**
 * Qué se lleva el cierre, ANTES de cerrar: cuántas órdenes se van a archivar, cuántas
 * quedan abiertas para el turno siguiente y cuántas se entregaron sin terminar de
 * cobrar.
 *
 * Es lo que se muestra en el formulario de cierre. Que se vea antes de firmar es la
 * mitad del valor de la pantalla: "3 quedan abiertas" es la última oportunidad de
 * darse cuenta de que un pedido nunca se marcó entregado.
 *
 * Las que quedan sin cobrar **se archivan igual**: si no, se quedarían en el tablero
 * para siempre, que es exactamente el problema que este módulo resuelve. Se avisan,
 * no se retienen.
 */
export async function summarizeArchivable(client, { tenantId }) {
  const [rows, unpaid] = await Promise.all([
    client.order.groupBy({
      by: ["status"],
      where: { tenantId, archivedAt: null },
      _count: { _all: true },
    }),
    client.order.count({
      where: {
        tenantId,
        archivedAt: null,
        status: "COMPLETED",
        paymentStatus: { notIn: SETTLED_PAYMENT_STATUSES },
      },
    }),
  ]);

  let toArchive = 0;
  let staysOpen = 0;

  for (const row of rows) {
    if (isArchivable(row.status)) toArchive += row._count._all;
    else staysOpen += row._count._all;
  }

  return { toArchive, staysOpen, unpaid };
}

/**
 * Archiva UNA orden. Es la salida manual: sacar del tablero algo ya cerrado sin
 * esperar al cierre del turno.
 *
 * `sessionId` puede ser null (tenant sin caja habilitada): la orden queda archivada
 * igual, solo que sin turno al cual colgarla en el historial.
 */
export async function archiveOrder(
  tx,
  { tenantId, orderId, sessionId = null, actorId = null, at = new Date() }
) {
  const order = await tx.order.findFirst({
    where: { id: orderId, tenantId },
    select: { id: true, status: true, archivedAt: true },
  });

  if (!order) {
    throw createError("Orden no encontrada", "ORDER_NOT_FOUND", 404);
  }

  // Idempotente: volver a archivar lo archivado no es un error ni re-sella el turno
  // —eso movería una orden de un turno ya arqueado a otro—, simplemente no hace nada.
  if (order.archivedAt) return order;

  if (!isArchivable(order.status)) {
    throw createError(
      "Solo se pueden archivar las órdenes entregadas o canceladas",
      "ORDER_NOT_ARCHIVABLE",
      409
    );
  }

  return tx.order.update({
    where: { id: order.id },
    data: { archivedAt: at, archivedById: actorId, cashSessionId: sessionId },
  });
}
