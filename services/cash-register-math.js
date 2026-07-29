import { createError } from "../helpers/error.js";
import { roundMoney } from "../helpers/price.js";

/**
 * Aritmética de la caja registradora.
 *
 * Todo lo que en este módulo se calcula es lo que después el cliente compara
 * contra los billetes que tiene en la mano, así que vive PURO y aparte del
 * servicio: recibe movimientos ya cargados y devuelve números. Mismo criterio que
 * `services/order-state.js` — se testea sin base, y el arqueo no depende de que
 * haya un Postgres arriba.
 */

/**
 * Signo de cada tipo de movimiento. El monto guardado es SIEMPRE positivo
 * (`CHECK amount > 0` en la migración); el signo vive acá, en un solo lugar, para
 * que no exista la posibilidad de un egreso de −50 escrito por un caller
 * distraído y descubierto tres semanas después, cuando el arqueo no cierra.
 *
 * Hay un test que verifica que este mapa cubra TODOS los valores del enum
 * `CashMovementType` leyendo `prisma/schema.prisma`: agregar un tipo sin decidir
 * su signo es exactamente el error que no se puede permitir acá.
 */
export const CASH_MOVEMENT_SIGN = {
  ORDER_DEPOSIT: 1,
  ORDER_PAYMENT: 1,
  ORDER_REFUND: -1,
  INCOME: 1,
  EXPENSE: -1,
};

/**
 * Los dos tipos que puede crear una persona por HTTP. Los `ORDER_*` los escribe
 * solo el servicio de órdenes, a partir del libro de cobros.
 */
export const MANUAL_MOVEMENT_TYPES = ["INCOME", "EXPENSE"];

/** Monto con signo de un movimiento. Es el único lugar que aplica el signo. */
export function signedAmount(movement) {
  const sign = CASH_MOVEMENT_SIGN[movement?.type];

  // Más estricto que `PAYMENT_SIGN[kind] ?? 1` en order-state a propósito: allá un
  // signo desconocido desviaría un `paymentStatus` que se recalcula; acá falsearía
  // plata contada.
  if (sign === undefined) {
    throw createError(
      `Tipo de movimiento de caja sin signo definido: "${movement?.type}"`,
      "CASH_MOVEMENT_TYPE_UNKNOWN",
      500
    );
  }

  return roundMoney(sign * Number(movement?.amount ?? 0));
}

/**
 * Resumen de una lista de movimientos.
 *
 * `cashNet` es lo único que mueve el arqueo: solo los movimientos en efectivo
 * están en el cajón. Las transferencias se acumulan aparte (`transferTotal`)
 * porque contarlas haría que la diferencia mienta siempre.
 *
 * `byCategory` cubre solo los movimientos etiquetados —los manuales, que son los
 * del local: sueldos, insumos, retiros—; los que vienen de una orden se leen en
 * `byType`, donde ya se distinguen por sí mismos.
 *
 * @param {Array} movements filas de `CashMovement`, con `category` incluida si se
 *   quiere el desglose con etiqueta legible.
 */
export function summarizeMovements(movements = []) {
  let cashNet = 0;
  let transferNet = 0;
  const byType = {};
  const byCategory = {};

  for (const movement of movements) {
    const signed = signedAmount(movement);

    if (movement.channel === "CASH") {
      cashNet = roundMoney(cashNet + signed);
    } else {
      transferNet = roundMoney(transferNet + signed);
    }

    byType[movement.type] = roundMoney((byType[movement.type] ?? 0) + signed);

    if (movement.categoryId != null) {
      const key = movement.category?.key ?? String(movement.categoryId);
      const bucket = byCategory[key] ?? {
        categoryId: movement.categoryId,
        label: movement.category?.label ?? null,
        total: 0,
        count: 0,
      };

      bucket.total = roundMoney(bucket.total + signed);
      bucket.count += 1;
      byCategory[key] = bucket;
    }
  }

  return {
    cashNet,
    transferTotal: transferNet,
    byType,
    byCategory,
    count: movements.length,
  };
}

/**
 * El arqueo: qué debería haber en el cajón, qué dijo la persona que contó, y la
 * diferencia. Negativa = falta plata.
 *
 * No verifica nada: el software no gestiona dinero, registra lo que un humano
 * declaró. Su valor es mostrar el desvío, no impedirlo.
 */
export function buildArqueo({ openingAmount = 0, movements = [], countedCashAmount = null }) {
  const { cashNet, transferTotal } = summarizeMovements(movements);
  const expectedCashAmount = roundMoney(Number(openingAmount) + cashNet);

  const counted =
    countedCashAmount == null ? null : roundMoney(Number(countedCashAmount));

  return {
    expectedCashAmount,
    countedCashAmount: counted,
    cashDifference: counted == null ? null : roundMoney(counted - expectedCashAmount),
    transferTotal,
  };
}
