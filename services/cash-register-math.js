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
 * `cashNet` y `transferTotal` van separados porque son dos lugares distintos donde
 * está la plata: el cajón y la cuenta. Cada uno tiene su arqueo —se cuentan contra
 * cosas distintas, billetes contra resumen del banco— y sumarlos en un solo número
 * haría que ninguna de las dos diferencias signifique nada.
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
 * Un cajón no puede deber plata: si el esperado da negativo, los egresos del turno
 * superaron al efectivo, y en la vida real eso significa que **falta registrar un
 * ingreso** (el clásico: el dueño paga un insumo de su bolsillo y no anota el
 * `INCOME`).
 *
 * Es una advertencia y nada más: no bloquea el cierre ni corrige el número. Nada
 * impide el egreso a propósito —bloquearlo sería peor que el problema—, pero hasta
 * ahora el número salía negativo y nadie lo señalaba.
 *
 * Cero NO es negativo: una caja vacía cuadra perfecto.
 */
export function isExpectedNegative(expectedCashAmount) {
  return Number(expectedCashAmount ?? 0) < 0;
}

/**
 * El arqueo de los DOS saldos de la caja: qué debería haber en el cajón y en la
 * cuenta, qué declaró la persona que contó, y las diferencias. Negativa = falta
 * plata.
 *
 * No verifica nada: el software no gestiona dinero, registra lo que un humano
 * declaró. Su valor es mostrar el desvío, no impedirlo.
 *
 * Ojo con los dos números de transferencias, que se parecen y no son lo mismo:
 * `transferTotal` es el NETO del turno (lo que se movió) y `expectedTransferAmount`
 * es el SALDO (la apertura más ese neto). Sumarlos duplica plata.
 *
 * Contar el banco es opcional: sin `countedTransferAmount` la diferencia queda en
 * `null` en vez de en 0 — el local que no lo mira al cerrar no firma un cuadre que
 * nadie verificó, igual que un cierre sin conteo de efectivo.
 */
export function buildArqueo({
  openingAmount = 0,
  openingTransferAmount = 0,
  movements = [],
  countedCashAmount = null,
  countedTransferAmount = null,
}) {
  const { cashNet, transferTotal } = summarizeMovements(movements);

  const expectedCashAmount = roundMoney(Number(openingAmount) + cashNet);
  const expectedTransferAmount = roundMoney(
    Number(openingTransferAmount) + transferTotal
  );

  const counted =
    countedCashAmount == null ? null : roundMoney(Number(countedCashAmount));
  const countedTransfer =
    countedTransferAmount == null
      ? null
      : roundMoney(Number(countedTransferAmount));

  return {
    expectedCashAmount,
    countedCashAmount: counted,
    cashDifference: counted == null ? null : roundMoney(counted - expectedCashAmount),
    transferTotal,
    expectedTransferAmount,
    countedTransferAmount: countedTransfer,
    transferDifference:
      countedTransfer == null
        ? null
        : roundMoney(countedTransfer - expectedTransferAmount),
    // Solo del efectivo: el aviso habla del cajón, que es lo que no puede deber
    // plata sin que falte un ingreso sin registrar.
    expectedNegative: isExpectedNegative(expectedCashAmount),
  };
}
