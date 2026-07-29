import { createError } from "../helpers/error.js";
import { roundMoney } from "../helpers/price.js";

/**
 * Motor de estados de las órdenes.
 *
 * Antes, las condiciones para mover una orden vivían como un bloque de ~50 ifs
 * adentro de `updateOrderStatus`, mezclando tres cosas distintas: si la
 * transición es válida, si los datos del pedido están completos y si el dinero
 * que hacía falta ya entró. Eso tenía dos costos: nadie podía preguntar "¿qué le
 * falta a esta orden?" sin intentar el cambio y comerse un 409, y no había forma
 * de avanzar el estado solo cuando las condiciones se cumplían.
 *
 * Acá vive esa lógica, y salvo `applyAutoAdvance` (que necesita escribir) todo es
 * PURO: recibe la orden ya cargada y devuelve datos. Por eso se puede testear sin
 * base y lo pueden consumir el servicio, el controller y el bot por igual.
 */

/**
 * Transiciones válidas por estado. Una orden solo avanza: nunca vuelve a un
 * estado anterior (si alguien marcó PROCESSING por error, el camino es cancelar,
 * igual que antes de este módulo). READY es un paso OPCIONAL: PROCESSING →
 * COMPLETED sigue siendo válido para no obligar a nadie a un click nuevo.
 *
 * COMPLETED y CANCELLED son terminales: sus errores tienen código propio
 * (ORDER_ALREADY_*) porque el panel ya los distingue.
 */
export const ORDER_TRANSITIONS = {
  PENDING: ["PROCESSING", "READY", "COMPLETED", "CANCELLED"],
  PROCESSING: ["READY", "COMPLETED", "CANCELLED"],
  READY: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

/**
 * Estados que exigen que la orden esté "buena para producir" (revisada, con los
 * datos completos y con el dinero que corresponda ya cobrado). CANCELLED queda
 * afuera a propósito: siempre se puede cancelar.
 */
export const PRODUCTION_STATUSES = ["PROCESSING", "READY", "COMPLETED"];

/**
 * Signo de cada tipo de fila del libro de cobros. El monto guardado es siempre
 * positivo (`CHECK amount > 0`); el signo vive acá, en un solo lugar, para que no
 * exista la posibilidad de un cobro de −50 escrito por un caller distraído.
 */
export const PAYMENT_SIGN = {
  DEPOSIT: 1,
  PAYMENT: 1,
  REFUND: -1,
};

// Medio centavo. Es tolerancia de `Float`, no una regla de negocio: sin esto,
// `4500.000000000001 >= 4500` decide si un pedido se produce o no.
export const MONEY_EPS = 0.005;

/**
 * Cuánto se espera cobrar por cada vía, según cómo se pactó el pago. Es la
 * fórmula que hasta ahora estaba implícita en los ifs de `paymentMethod`:
 * MIXED reparte según el desglose, CASH/TRANSFER van al total, y una orden sin
 * método pactado (las que crea el bot) no espera nada por ninguna vía todavía.
 */
export function expectedByChannel(order) {
  const total = Number(order.total ?? 0);

  if (order.paymentMethod === "MIXED") {
    return {
      CASH: roundMoney(Number(order.cashAmount ?? 0)),
      TRANSFER: roundMoney(Number(order.transferAmount ?? 0)),
    };
  }
  if (order.paymentMethod === "CASH") return { CASH: roundMoney(total), TRANSFER: 0 };
  if (order.paymentMethod === "TRANSFER") return { CASH: 0, TRANSFER: roundMoney(total) };

  return { CASH: 0, TRANSFER: 0 };
}

/**
 * Reconstrucción aproximada del dinero cuando el libro de cobros NO viene cargado
 * (una query que no lo incluyó). Es exactamente lo que se podía deducir antes de
 * que el libro existiera: el total si el cobro está cerrado, la seña si solo se
 * confirmó la seña, cero si no entró nada.
 *
 * Existe para que una consulta sin `include: { payments: true }` NO haga aparecer
 * blockers falsos: sin este fallback, "no cargué las filas" y "no cobré nada" se
 * verían igual, y una orden pagada quedaría trabada.
 */
function estimateFromSeals(order, total, expected) {
  const settled = ["PAID_IN_FULL", "APPROVED"].includes(order.paymentStatus);
  const paid = settled
    ? total
    : order.paymentStatus === "DEPOSIT_PAID"
      ? roundMoney(Number(order.depositAmount ?? 0))
      : 0;

  return {
    total,
    paid,
    // Los sellos viejos no registraban devoluciones: lo que se pueda deducir de
    // ellos es siempre plata que entró.
    charged: paid,
    refunded: 0,
    pending: roundMoney(Math.max(total - paid, 0)),
    settled,
    expected,
    // El sello de transferencia no dice monto: se asume que cubrió lo que la
    // orden esperaba por esa vía, que es lo que significaba antes del libro.
    byChannel: {
      CASH: 0,
      TRANSFER: order.transferConfirmedAt ? expected.TRANSFER : 0,
      GATEWAY: settled && order.paymentStatus === "APPROVED" ? total : 0,
    },
    estimated: true,
  };
}

/**
 * Resumen del dinero de la orden a partir del **libro de cobros**
 * (`OrderPayment`): cuánto entró, por qué vía, y cuánto falta.
 *
 * Es el único lugar del módulo que sabe cómo se guarda el dinero. Si el libro no
 * está cargado, cae a `estimateFromSeals` y lo marca con `estimated: true` para
 * que nadie confunda una estimación con la cuenta real.
 *
 * @param {object} order
 * @param {Array}  [payments] filas del libro; por defecto `order.payments`
 */
export function paymentSummary(order, payments = order?.payments) {
  const total = roundMoney(Number(order.total ?? 0));
  const expected = expectedByChannel(order);

  if (!Array.isArray(payments)) return estimateFromSeals(order, total, expected);

  const byChannel = { CASH: 0, TRANSFER: 0, GATEWAY: 0 };
  let paid = 0;
  // `charged` y `refunded` se llevan aparte porque `paid` ya viene neteado: sin
  // ellos, "cobré 5000 y devolví 5000" y "nunca cobré nada" son el mismo número.
  let charged = 0;
  let refunded = 0;

  for (const entry of payments) {
    const amount = Number(entry.amount ?? 0);
    const signed = (PAYMENT_SIGN[entry.kind] ?? 1) * amount;
    byChannel[entry.channel] = roundMoney((byChannel[entry.channel] ?? 0) + signed);
    paid = roundMoney(paid + signed);

    if (entry.kind === "REFUND") refunded = roundMoney(refunded + amount);
    else charged = roundMoney(charged + amount);
  }

  return {
    total,
    paid,
    charged,
    refunded,
    pending: roundMoney(Math.max(total - paid, 0)),
    settled: paid + MONEY_EPS >= total,
    expected,
    byChannel,
    entries: payments.length,
    estimated: false,
  };
}

/**
 * Cuánto falta cobrar por cada vía, según lo pactado. Es lo que evita cobrar dos
 * veces: `confirmPayment` sobre una orden que ya tuvo seña registra el remanente,
 * no el total de nuevo.
 *
 * Una orden sin `paymentMethod` no espera nada por ninguna vía (da 0 en las dos):
 * el caller tiene que tratar ese caso como un error explícito, no como "ya está
 * todo cobrado" — ver `resolvePaymentChannel` en services/orders.js.
 */
export function pendingByChannel(order, payments = order?.payments) {
  const { expected, byChannel } = paymentSummary(order, payments);

  return {
    CASH: roundMoney(Math.max(expected.CASH - (byChannel.CASH ?? 0), 0)),
    TRANSFER: roundMoney(Math.max(expected.TRANSFER - (byChannel.TRANSFER ?? 0), 0)),
  };
}

/**
 * `Order.paymentStatus` a partir del libro. La columna se conserva —los listados
 * y las estadísticas filtran por SQL— pero pasa a ser un CACHE de esta función,
 * recalculado en la misma transacción cada vez que el libro cambia.
 *
 * `APPROVED` se preserva para lo que cobró MercadoPago, que es el valor que ese
 * webhook viene escribiendo desde siempre y que el panel ya distingue.
 */
export function derivePaymentStatus(order, payments = order?.payments) {
  const { total, paid, refunded, byChannel } = paymentSummary(order, payments);

  // Primera, y antes que `APPROVED`, a propósito: una orden que cobró MercadoPago
  // y se devolvió en efectivo conserva `byChannel.GATEWAY == total`, así que más
  // abajo `APPROVED` ganaría y la devolución quedaría invisible.
  //
  // Solo la devolución TOTAL cambia el estado. Una parcial sigue derivando de
  // `paid` (el enum no tiene `PARTIALLY_REFUNDED` y no vale una migración por
  // eso): el detalle queda en `payment.refunded`, que el panel sí puede mostrar.
  if (refunded > MONEY_EPS && paid <= MONEY_EPS) return "REFUNDED";

  if (total > 0 && (byChannel.GATEWAY ?? 0) + MONEY_EPS >= total) return "APPROVED";
  if (total > 0 && paid + MONEY_EPS >= total) return "PAID_IN_FULL";
  if (paid > MONEY_EPS) return "DEPOSIT_PAID";
  if (order.preferenceId) return "IN_PROCESS";

  return "PENDING";
}

/**
 * El requisito de DINERO para poder producir, en una sola regla:
 *
 * - Si el tenant usa seña, alcanza con la seña cobrada. Es el trato: se produce
 *   contra la seña, el saldo se cobra al entregar.
 * - Si no usa seña y el pago era por transferencia (total o parte del mixto), esa
 *   parte tiene que estar cobrada antes de ponerse a producir.
 * - En efectivo no se exige nada: se paga contraentrega.
 *
 * Antes eran dos guards que se pisaban: una orden con seña Y transferencia exigía
 * las dos confirmaciones, y la segunda terminaba sellando "cobré todo" cuando lo
 * que había entrado era solo la seña.
 */
function moneyBlocker(order, payment) {
  if (order.requiresDeposit) {
    const seña = roundMoney(Number(order.depositAmount ?? 0));

    // Sin monto de seña pactado no hay nada que comparar: se cae al estado de
    // pago, que es lo que se miraba antes de que el dinero tuviera montos.
    const cubierta =
      seña > 0
        ? payment.paid + MONEY_EPS >= seña
        : ["DEPOSIT_PAID", "PAID_IN_FULL", "APPROVED"].includes(order.paymentStatus);

    return cubierta
      ? null
      : {
          code: "DEPOSIT_NOT_CONFIRMED",
          message: "La seña debe estar confirmada antes de producir",
          details: { seña, cobrado: payment.paid },
        };
  }

  if (!["TRANSFER", "MIXED"].includes(order.paymentMethod)) return null;

  const esperado = payment.expected.TRANSFER;
  const cobrado = payment.byChannel?.TRANSFER ?? 0;
  if (esperado <= 0 || cobrado + MONEY_EPS >= esperado) return null;

  return {
    code: "TRANSFER_NOT_CONFIRMED",
    message: "La transferencia debe estar confirmada antes de producir",
    details: { esperado, cobrado },
  };
}

/**
 * Qué le falta a la orden para poder producirse. Array vacío = no le falta nada.
 *
 * El orden importa: es el que decide qué error ve quien fuerza la transición a
 * mano, y se mantiene igual al que tenían los ifs originales para no cambiarle
 * el código de error a un panel que ya lo maneja.
 */
function collectBlockers(order, payment) {
  const blockers = [];

  // Toda orden cargada por el cliente (bot o storefront) necesita el OK de un
  // humano. Las ADMIN las carga alguien de la casa: nacen validadas.
  if (order.origin !== "ADMIN" && order.reviewedById == null) {
    blockers.push({
      code: "ORDER_NOT_REVIEWED",
      message:
        "La orden debe ser revisada por un administrador antes de producir",
    });
  }

  const dinero = moneyBlocker(order, payment);
  if (dinero?.code === "DEPOSIT_NOT_CONFIRMED") blockers.push(dinero);

  if (!order.fulfillmentMethod || !order.paymentMethod) {
    blockers.push({
      code: "FULFILLMENT_INCOMPLETE",
      message:
        "Falta completar método de entrega y/o de pago antes de producir",
    });
  }

  // Alcanza con una de las dos: hay clientes que solo mandan el link de Maps que
  // comparten desde el teléfono, sin escribir la calle.
  if (
    order.fulfillmentMethod === "DELIVERY" &&
    !order.addressText &&
    !order.addressMapsUrl
  ) {
    blockers.push({
      code: "ADDRESS_MISSING",
      message: "Falta la dirección de entrega",
    });
  }

  if (dinero?.code === "TRANSFER_NOT_CONFIRMED") blockers.push(dinero);

  return blockers;
}

/**
 * Foto completa de la orden para decidir (y para mostrar en el panel).
 *
 * @param {object} order
 * @param {Array}  [payments] filas del libro de cobros; por defecto `order.payments`
 * @returns {{
 *   payment: object,        // resumen de dinero (ver paymentSummary)
 *   blockers: Array,        // qué falta para producir; vacío = nada
 *   canProduce: boolean,
 *   nextStatus: string|null // avance automático que corresponde, si corresponde
 * }}
 */
export function evaluateOrder(order, payments = order?.payments) {
  const payment = paymentSummary(order, payments);
  const terminal = ["COMPLETED", "CANCELLED"].includes(order.status);
  const blockers = terminal ? [] : collectBlockers(order, payment);
  const canProduce = !terminal && blockers.length === 0;

  return {
    payment,
    blockers,
    canProduce,
    // Solo se automatiza la ENTRADA a producción: que un pedido revisado y
    // cobrado empiece a prepararse es una consecuencia de las condiciones. Que
    // esté listo o entregado son hechos físicos que solo una persona sabe, así
    // que READY y COMPLETED siguen siendo manuales.
    nextStatus: canProduce && order.status === "PENDING" ? "PROCESSING" : null,
  };
}

/**
 * Valida que la transición pedida a mano sea posible. Lanza con los mismos
 * códigos/estados HTTP que antes del refactor.
 */
export function assertTransition(order, target) {
  if (order.status === "COMPLETED") {
    throw createError(
      "No se puede modificar una orden completada",
      "ORDER_ALREADY_COMPLETED",
      409
    );
  }

  if (order.status === "CANCELLED") {
    throw createError(
      "No se puede modificar una orden cancelada",
      "ORDER_ALREADY_CANCELLED",
      409
    );
  }

  if (!(ORDER_TRANSITIONS[order.status] ?? []).includes(target)) {
    throw createError(
      "Transición de estado no permitida",
      "INVALID_STATUS_TRANSITION",
      400
    );
  }
}

/**
 * Lanza el primer blocker como 409 si la orden no está en condiciones de
 * producirse. `evaluation` es opcional para no recalcular si el caller ya la
 * tiene.
 */
export function assertCanProduce(order, evaluation = evaluateOrder(order)) {
  const [blocker] = evaluation.blockers;
  if (!blocker) return;

  const error = createError(blocker.message, blocker.code, 409);
  if (blocker.details) error.details = blocker.details;
  throw error;
}

/**
 * Única función del módulo que escribe. Avanza la orden sola si sus condiciones
 * quedaron cumplidas — se llama al final de toda mutación que pueda cambiarlas
 * (revisión, confirmación de cobro, edición de entrega/pago).
 *
 * Corre DENTRO de la transacción del caller: el avance y el cambio que lo
 * habilitó entran o no entran juntos. Es un no-op silencioso si no corresponde
 * avanzar, así ningún caller necesita preguntar antes.
 *
 * @param {object} tx       cliente de transacción de Prisma
 * @param {object} order    la orden DESPUÉS del cambio que dispara la evaluación
 * @param {number|null} [actorId] quién hizo el cambio que la destrabó
 * @returns {Promise<{ order: object, advancedTo: string|null }>}
 */
export async function applyAutoAdvance(tx, order, { actorId = null } = {}) {
  const { nextStatus } = evaluateOrder(order);
  if (!nextStatus) return { order, advancedTo: null };

  const updated = await tx.order.update({
    where: { id: order.id },
    data: { status: nextStatus },
  });

  await tx.orderStatusHistory.create({
    data: {
      orderId: order.id,
      fromStatus: order.status,
      toStatus: nextStatus,
      note: "Pasó a preparación automáticamente: el pedido quedó completo",
      changedById: actorId,
      trigger: "AUTO",
    },
  });

  return { order: { ...order, ...updated }, advancedTo: nextStatus };
}
