import { describe, it, expect } from "vitest";
import {
  ORDER_TRANSITIONS,
  assertCanProduce,
  assertTransition,
  derivePaymentStatus,
  evaluateOrder,
  expectedByChannel,
  paymentSummary,
  pendingByChannel,
} from "../services/order-state.js";

// El motor es puro: recibe la orden ya cargada y devuelve datos. Por eso todo
// este archivo corre sin base — que es justamente el punto de haberlo separado
// de services/orders.js.

/** Orden mínima que NO tiene nada pendiente: es la base de casi todos los casos. */
function orderReady(overrides = {}) {
  return {
    id: 1,
    status: "PENDING",
    origin: "ADMIN",
    reviewedById: null,
    total: 10000,
    paymentStatus: "PENDING",
    paymentMethod: "CASH",
    cashAmount: null,
    transferAmount: null,
    fulfillmentMethod: "PICKUP",
    addressText: null,
    addressMapsUrl: null,
    transferConfirmedAt: null,
    requiresDeposit: false,
    depositAmount: null,
    ...overrides,
  };
}

const codes = (order) => evaluateOrder(order).blockers.map((b) => b.code);

describe("evaluateOrder — qué le falta a la orden", () => {
  it("una orden ADMIN completa no tiene blockers y puede producir", () => {
    const { blockers, canProduce, nextStatus } = evaluateOrder(orderReady());

    expect(blockers).toEqual([]);
    expect(canProduce).toBe(true);
    expect(nextStatus).toBe("PROCESSING");
  });

  it("una orden del cliente sin revisar queda trabada", () => {
    expect(codes(orderReady({ origin: "STORE" }))).toContain(
      "ORDER_NOT_REVIEWED"
    );
  });

  it("una orden ADMIN no necesita revisión (la cargó alguien de la casa)", () => {
    expect(codes(orderReady({ origin: "ADMIN" }))).not.toContain(
      "ORDER_NOT_REVIEWED"
    );
  });

  it("sin método de entrega o de pago: FULFILLMENT_INCOMPLETE", () => {
    expect(codes(orderReady({ paymentMethod: null }))).toContain(
      "FULFILLMENT_INCOMPLETE"
    );
    expect(codes(orderReady({ fulfillmentMethod: null }))).toContain(
      "FULFILLMENT_INCOMPLETE"
    );
  });

  it("DELIVERY sin ninguna ubicación: ADDRESS_MISSING", () => {
    expect(codes(orderReady({ fulfillmentMethod: "DELIVERY" }))).toContain(
      "ADDRESS_MISSING"
    );
  });

  it("DELIVERY con solo el link de Maps alcanza", () => {
    const order = orderReady({
      fulfillmentMethod: "DELIVERY",
      addressMapsUrl: "https://maps.app.goo.gl/abc",
    });
    expect(codes(order)).not.toContain("ADDRESS_MISSING");
  });

  it("seña pendiente: DEPOSIT_NOT_CONFIRMED; confirmada, destraba", () => {
    const conSeña = orderReady({ requiresDeposit: true, depositAmount: 5000 });
    expect(codes(conSeña)).toContain("DEPOSIT_NOT_CONFIRMED");

    const cobrada = { ...conSeña, paymentStatus: "DEPOSIT_PAID" };
    expect(codes(cobrada)).not.toContain("DEPOSIT_NOT_CONFIRMED");
  });

  it("transferencia sin confirmar: TRANSFER_NOT_CONFIRMED", () => {
    expect(codes(orderReady({ paymentMethod: "TRANSFER" }))).toContain(
      "TRANSFER_NOT_CONFIRMED"
    );
    expect(
      codes(orderReady({ paymentMethod: "TRANSFER", transferConfirmedAt: new Date() }))
    ).not.toContain("TRANSFER_NOT_CONFIRMED");
  });

  it("acumula todos los blockers, no solo el primero", () => {
    const order = orderReady({
      origin: "BOT",
      paymentMethod: null,
      fulfillmentMethod: null,
      requiresDeposit: true,
    });

    expect(codes(order)).toEqual([
      "ORDER_NOT_REVIEWED",
      "DEPOSIT_NOT_CONFIRMED",
      "FULFILLMENT_INCOMPLETE",
    ]);
  });

  it("una orden ya en producción no propone avance automático", () => {
    const { canProduce, nextStatus } = evaluateOrder(
      orderReady({ status: "PROCESSING" })
    );

    expect(canProduce).toBe(true);
    expect(nextStatus).toBeNull();
  });

  it("una orden terminal no tiene blockers ni avanza", () => {
    for (const status of ["COMPLETED", "CANCELLED"]) {
      const evaluation = evaluateOrder(orderReady({ status, origin: "BOT" }));
      expect(evaluation.blockers).toEqual([]);
      expect(evaluation.canProduce).toBe(false);
      expect(evaluation.nextStatus).toBeNull();
    }
  });
});

/** Fila del libro de cobros. */
const cobro = (amount, channel = "CASH", kind = "PAYMENT") => ({
  kind,
  channel,
  amount,
});

describe("paymentSummary sobre el libro de cobros", () => {
  it("suma las filas y las reparte por vía", () => {
    const summary = paymentSummary(orderReady(), [
      cobro(3000, "CASH"),
      cobro(4000, "TRANSFER"),
    ]);

    expect(summary).toMatchObject({
      paid: 7000,
      pending: 3000,
      settled: false,
      estimated: false,
    });
    expect(summary.byChannel).toMatchObject({ CASH: 3000, TRANSFER: 4000 });
  });

  it("la devolución resta: el signo lo pone el tipo, no el monto", () => {
    const summary = paymentSummary(orderReady(), [
      cobro(10000, "CASH"),
      cobro(2500, "CASH", "REFUND"),
    ]);

    expect(summary.paid).toBe(7500);
    expect(summary.byChannel.CASH).toBe(7500);
    expect(summary.settled).toBe(false);
    // `paid` viene neteado; `charged`/`refunded` son lo que permite contar el
    // movimiento bruto (y lo que va a necesitar el arqueo de Caja).
    expect(summary.charged).toBe(10000);
    expect(summary.refunded).toBe(2500);
  });

  it("cobrado justo el total: queda saldada", () => {
    expect(paymentSummary(orderReady(), [cobro(10000)])).toMatchObject({
      paid: 10000,
      pending: 0,
      settled: true,
    });
  });

  it("sin el libro cargado estima desde los sellos y lo avisa", () => {
    const summary = paymentSummary(orderReady({ paymentStatus: "PAID_IN_FULL" }));

    expect(summary).toMatchObject({ paid: 10000, settled: true, estimated: true });
  });
});

describe("derivePaymentStatus y las devoluciones", () => {
  it("devuelta entera queda REFUNDED, no PENDING", () => {
    const status = derivePaymentStatus(orderReady(), [
      cobro(10000, "CASH"),
      cobro(10000, "CASH", "REFUND"),
    ]);

    expect(status).toBe("REFUNDED");
  });

  it("una orden que nunca cobró nada sigue en PENDING", () => {
    expect(derivePaymentStatus(orderReady(), [])).toBe("PENDING");
  });

  it("la devolución parcial no cambia el estado: deriva del neto", () => {
    const status = derivePaymentStatus(orderReady(), [
      cobro(10000, "CASH"),
      cobro(2500, "CASH", "REFUND"),
    ]);

    expect(status).toBe("DEPOSIT_PAID");
  });

  it("le gana a APPROVED: lo cobrado por MercadoPago y devuelto en efectivo", () => {
    // El caso que obliga a evaluar REFUNDED primero: la vía GATEWAY sigue
    // sumando el total, así que el chequeo de APPROVED daría verdadero.
    const status = derivePaymentStatus(orderReady(), [
      cobro(10000, "GATEWAY"),
      cobro(10000, "CASH", "REFUND"),
    ]);

    expect(status).toBe("REFUNDED");
  });
});

describe("derivePaymentStatus", () => {
  it.each([
    [[], "PENDING"],
    [[cobro(2000)], "DEPOSIT_PAID"],
    [[cobro(10000)], "PAID_IN_FULL"],
    [[cobro(6000), cobro(4000, "TRANSFER")], "PAID_IN_FULL"],
    [[cobro(10000, "GATEWAY")], "APPROVED"],
  ])("%j → %s", (payments, esperado) => {
    expect(derivePaymentStatus(orderReady(), payments)).toBe(esperado);
  });

  it("con preferencia de MercadoPago creada y sin cobros: IN_PROCESS", () => {
    expect(
      derivePaymentStatus(orderReady({ preferenceId: "pref-1" }), [])
    ).toBe("IN_PROCESS");
  });
});

describe("pendingByChannel", () => {
  it("descuenta lo cobrado de lo esperado por cada vía", () => {
    const order = orderReady({
      paymentMethod: "MIXED",
      cashAmount: 4000,
      transferAmount: 6000,
    });

    expect(pendingByChannel(order, [cobro(6000, "TRANSFER")])).toEqual({
      CASH: 4000,
      TRANSFER: 0,
    });
  });
});

describe("el requisito de dinero para producir", () => {
  it("con seña, alcanza con la seña cobrada aunque el pago sea por transferencia", () => {
    const order = orderReady({
      paymentMethod: "TRANSFER",
      requiresDeposit: true,
      depositAmount: 5000,
    });

    expect(codes(order)).toContain("DEPOSIT_NOT_CONFIRMED");
    expect(evaluateOrder(order, [cobro(5000, "TRANSFER", "DEPOSIT")]).canProduce).toBe(
      true
    );
  });

  it("sin seña, la parte por transferencia tiene que estar cobrada entera", () => {
    const order = orderReady({
      paymentMethod: "MIXED",
      cashAmount: 4000,
      transferAmount: 6000,
    });

    const parcial = evaluateOrder(order, [cobro(2000, "TRANSFER")]);
    expect(parcial.blockers.map((b) => b.code)).toContain("TRANSFER_NOT_CONFIRMED");

    expect(evaluateOrder(order, [cobro(6000, "TRANSFER")]).canProduce).toBe(true);
  });

  it("en efectivo no se exige nada por adelantado: se paga contraentrega", () => {
    expect(evaluateOrder(orderReady({ paymentMethod: "CASH" }), []).canProduce).toBe(
      true
    );
  });
});

describe("paymentSummary", () => {
  it("sin cobros: todo pendiente", () => {
    expect(paymentSummary(orderReady())).toMatchObject({
      total: 10000,
      paid: 0,
      pending: 10000,
      settled: false,
    });
  });

  it("con la seña cobrada: paid = seña", () => {
    const order = orderReady({
      requiresDeposit: true,
      depositAmount: 4000,
      paymentStatus: "DEPOSIT_PAID",
    });

    expect(paymentSummary(order)).toMatchObject({ paid: 4000, pending: 6000 });
  });

  it.each(["PAID_IN_FULL", "APPROVED"])("con %s: no queda nada pendiente", (paymentStatus) => {
    expect(paymentSummary(orderReady({ paymentStatus }))).toMatchObject({
      paid: 10000,
      pending: 0,
      settled: true,
    });
  });
});

describe("expectedByChannel", () => {
  it("reparte el mixto según el desglose pactado", () => {
    const order = orderReady({
      paymentMethod: "MIXED",
      cashAmount: 3000,
      transferAmount: 7000,
    });

    expect(expectedByChannel(order)).toEqual({ CASH: 3000, TRANSFER: 7000 });
  });

  it("manda el total a la única vía cuando no es mixto", () => {
    expect(expectedByChannel(orderReady({ paymentMethod: "CASH" }))).toEqual({
      CASH: 10000,
      TRANSFER: 0,
    });
    expect(expectedByChannel(orderReady({ paymentMethod: "TRANSFER" }))).toEqual({
      CASH: 0,
      TRANSFER: 10000,
    });
  });

  it("una orden sin método pactado todavía no espera nada", () => {
    expect(expectedByChannel(orderReady({ paymentMethod: null }))).toEqual({
      CASH: 0,
      TRANSFER: 0,
    });
  });
});

describe("assertTransition", () => {
  it("no deja volver a un estado anterior", () => {
    expect(() => assertTransition(orderReady({ status: "READY" }), "PROCESSING"))
      .toThrowError(expect.objectContaining({ code: "INVALID_STATUS_TRANSITION" }));
    expect(() => assertTransition(orderReady({ status: "PROCESSING" }), "PENDING"))
      .toThrowError(expect.objectContaining({ code: "INVALID_STATUS_TRANSITION" }));
  });

  it("READY es opcional: PROCESSING → COMPLETED sigue siendo válido", () => {
    expect(() =>
      assertTransition(orderReady({ status: "PROCESSING" }), "COMPLETED")
    ).not.toThrow();
  });

  it("los terminales tienen su propio código de error", () => {
    expect(() => assertTransition(orderReady({ status: "COMPLETED" }), "CANCELLED"))
      .toThrowError(expect.objectContaining({ code: "ORDER_ALREADY_COMPLETED" }));
    expect(() => assertTransition(orderReady({ status: "CANCELLED" }), "PROCESSING"))
      .toThrowError(expect.objectContaining({ code: "ORDER_ALREADY_CANCELLED" }));
  });

  it("siempre se puede cancelar una orden viva", () => {
    for (const status of ["PENDING", "PROCESSING", "READY"]) {
      expect(() => assertTransition(orderReady({ status }), "CANCELLED")).not.toThrow();
      expect(ORDER_TRANSITIONS[status]).toContain("CANCELLED");
    }
  });
});

describe("assertCanProduce", () => {
  it("lanza el primer blocker como 409", () => {
    try {
      assertCanProduce(orderReady({ origin: "BOT" }));
      throw new Error("debería haber lanzado");
    } catch (error) {
      expect(error.code).toBe("ORDER_NOT_REVIEWED");
      expect(error.statusCode ?? error.status).toBe(409);
    }
  });

  it("no lanza si la orden está completa", () => {
    expect(() => assertCanProduce(orderReady())).not.toThrow();
  });
});
