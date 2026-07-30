import { MONEY_EPS, PAYMENT_SIGN } from "../order-state.js";
import { summarizeMovements } from "../cash-register-math.js";
import { round } from "./utils.js";

/**
 * El cruce entre lo que se vendió y lo que se cobró, y entre lo que entró y lo que
 * salió de la caja. Puro: recibe filas ya cargadas y devuelve números.
 *
 * Hasta acá el dashboard solo sabía de **facturación** (la suma de `total` de las
 * órdenes completadas) y no de **plata**: no distinguía una orden entregada y
 * cobrada de una entregada con la transferencia sin confirmar, ni sabía por qué vía
 * entró nada. Con el libro de cobros y la caja las dos preguntas tienen respuesta.
 *
 * Los signos NO se redefinen acá: salen de `PAYMENT_SIGN` (libro de cobros) y de
 * `summarizeMovements` (caja), que son los de siempre.
 */

/**
 * Resume filas del libro de cobros de VARIAS órdenes. `paymentSummary`
 * (order-state.js) hace esto para una orden sola y contra su total; acá no hay
 * total contra el que comparar, solo plata que entró y salió en una ventana.
 */
export function summarizePayments(payments = []) {
  let cobrado = 0;
  let devuelto = 0;
  let cobros = 0;
  const porVia = { CASH: 0, TRANSFER: 0, GATEWAY: 0 };

  for (const payment of payments) {
    const amount = Number(payment.amount ?? 0);
    const signed = (PAYMENT_SIGN[payment.kind] ?? 1) * amount;

    cobrado = round(cobrado + signed);
    porVia[payment.channel] = round((porVia[payment.channel] ?? 0) + signed);

    if (payment.kind === "REFUND") devuelto = round(devuelto + amount);
    else cobros += 1;
  }

  // `cobrado` viene NETEADO de devoluciones, igual que el `paid` de una orden: es
  // la plata que quedó, no la que pasó por la caja.
  return { cobrado, devuelto, cobros, porVia };
}

/**
 * Facturado vs cobrado del período, con el desglose por vía.
 *
 * `brecha` es el número que antes no existía: positivo = se entregó más de lo que
 * se cobró (transferencias sin confirmar, saldos de seña sin cerrar); negativo = se
 * cobró más de lo entregado (señas de pedidos que todavía no salieron, que es lo
 * normal en un tenant que produce a pedido).
 *
 * @param {number} p.facturado suma de `total` de las órdenes COMPLETED del período
 */
export function buildCollectionsPanel({ facturado = 0, payments = [], previousPayments = [] }) {
  const actual = summarizePayments(payments);
  const anterior = summarizePayments(previousPayments);

  return {
    facturado: round(facturado),
    cobrado: round(actual.cobrado),
    cobradoPrevio: round(anterior.cobrado),
    brecha: round(facturado - actual.cobrado),
    devuelto: actual.devuelto,
    cobros: actual.cobros,
    porVia: actual.porVia,
  };
}

/**
 * Lo que pasó por la caja física en el período: cuántos turnos, en qué se fue la
 * plata, y si los cierres dan.
 *
 * **La unidad es el turno, no el día.** Un negocio puede abrir tres turnos en un día
 * (mañana, tarde y noche) y el de la noche cierra después de medianoche: por eso un
 * turno no se parte por fecha, se toma entero y cuenta en el día en que **se abrió**
 * —que es como el cliente lo nombra ("el turno noche del sábado")—. Los movimientos
 * de la madrugada del domingo entran igual en ese turno.
 *
 * @param {Array}  p.sessions turnos ABIERTOS en la ventana, con sus `movements`
 * @param {number} p.cobrado  neto del libro en la ventana, para el resultado
 */
export function buildCashPanel({ sessions = [], cobrado = 0 }) {
  const movements = sessions.flatMap((session) => session.movements ?? []);
  const { byType, byCategory } = summarizeMovements(movements);

  // `byType` ya viene con signo: EXPENSE es negativo.
  const egresos = round(byType.EXPENSE ?? 0);
  const ingresosManuales = round(byType.INCOME ?? 0);

  const cerrados = sessions.filter((session) => session.status === "CLOSED");
  // Los cerrados SIN conteo no tienen arqueo (`cashDifference` es null) y por eso no
  // suman a la diferencia. Se cuentan aparte a propósito: "todos los turnos cerraron
  // bien" con la mitad sin contar es una mentira por omisión.
  const sinArqueo = cerrados.filter((session) => session.closedWithoutCount);
  const diferenciaAcumulada = round(
    cerrados.reduce((total, session) => total + (session.cashDifference ?? 0), 0)
  );

  return {
    turnos: sessions.length,
    turnosCerrados: cerrados.length,
    turnoAbierto: sessions.some((session) => session.status === "OPEN"),

    ingresosManuales,
    egresos,

    // Desde que los movimientos de orden llevan etiqueta reservada ("Venta",
    // "Devolución"), este eje cubre el 100% de la plata del turno y su suma coincide
    // con el neto. De mayor egreso a mayor ingreso.
    porEtiqueta: Object.entries(byCategory)
      .map(([key, bucket]) => ({ key, ...bucket }))
      .sort((a, b) => a.total - b.total),

    // Solo lo que SALE. Se mantiene aparte de `porEtiqueta` justamente porque ahora
    // ahí también están las ventas, y "en qué se va la plata" no puede empezar con
    // una fila gigante de ingresos.
    egresosPorEtiqueta: Object.entries(byCategory)
      .map(([key, bucket]) => ({ key, ...bucket }))
      .filter((bucket) => bucket.total < 0)
      .sort((a, b) => a.total - b.total),

    // La respuesta a "¿este turno cierra siempre corto?". Negativo = falta plata.
    diferenciaAcumulada,
    turnosConDiferencia: cerrados.filter(
      (session) => Math.abs(session.cashDifference ?? 0) > MONEY_EPS
    ).length,
    // Turnos que el sistema cerró por vencimiento, sin que nadie contara. Si esto
    // crece, la diferencia acumulada dice cada vez menos.
    turnosSinArqueo: sinArqueo.length,

    // Cobrado menos lo que salió del local. Es un resultado **de caja**: la
    // mercadería está incluida si se carga como egreso (etiquetas "Insumos" /
    // "Proveedores"), así que la pregunta "¿me quedó plata este mes?" la contesta
    // bien.
    //
    // Lo que NO es, y por qué no alcanza para "¿gano dinero?":
    //  - **momento**: la mercadería pesa el día que se COMPRÓ, no el día que se
    //    vendió. Una compra grande hunde el resultado de esa ventana y regala las
    //    siguientes; en un mes cerrado se compensa, en un turno no;
    //  - **atribución**: el egreso no está pegado a ningún producto, así que de acá
    //    no sale margen por producto ni por combo. Eso pide un costo por variante
    //    (ver [[Caja]] → Fuera de alcance), no una etiqueta más.
    //  - y las dos ventanas no son la misma (cobros por fecha, turnos por apertura).
    resultadoAproximado: round(cobrado + egresos + ingresosManuales),
  };
}
