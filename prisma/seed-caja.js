// Órdenes de prueba para el MÓDULO DE CAJA: deja un turno abierto, con plata
// adentro y con órdenes en todos los estados que el arqueo tiene que saber tratar
// —incluidas las que todavía NO están cobradas, que son las que se aprietan desde
// el panel para ver el movimiento aparecer en vivo—.
//
//   node prisma/seed-caja.js                        # mesa-dulce
//   node prisma/seed-caja.js acme
//   node prisma/seed-caja.js mesa-dulce --apertura=50000
//   node prisma/seed-caja.js mesa-dulce --reset     # borra lo que sembró antes
//
// POR QUÉ NO ALCANZA CON `prisma/mesa-dulce/ordenes.js`: aquel arma las órdenes y
// su libro de cobros DIRECTO con `prisma.order.create`, salteándose
// `recordOrderPayments`. Las órdenes quedan cobradas y la caja no se entera nunca:
// cero `CashMovement`, arqueo vacío, y el módulo se ve como si no funcionara.
// Sirve para probar el tablero de órdenes, no la caja.
//
// Acá cada peso entra por los services reales —checkout → confirmaciones →
// completar—, que es el ÚNICO camino por el que un cobro llega al turno. Efecto
// secundario buscado: si el enganche entre el libro de cobros y la caja se rompe,
// este script deja de sembrar movimientos y se nota en el resumen final.
//
// Requiere la caja prendida:  node prisma/set-cash-register.js <slug> on
import "dotenv/config";
import { pathToFileURL } from "node:url";

import prisma from "../lib/prisma.js";
import { closeRedis } from "../lib/redis.js";
import { roundMoney } from "../helpers/price.js";
import { CartModel } from "../services/cart.js";
import { OrderModel } from "../services/orders.js";
import { CashRegisterModel } from "../services/cash-register.js";

const DEFAULT_SLUG = "mesa-dulce";
const APERTURA_DEFAULT = 20000;

// Marca de agua de las órdenes de este script, para que `--reset` sepa cuáles son
// suyas y no toque un pedido real. Mismo truco que usa `prisma/mesa-dulce/ordenes.js`
// con `seed-order-`: `paymentId` es el id del cobro de MercadoPago y en una orden
// de efectivo/transferencia no lo escribe nadie.
const TAG = "seed-caja-";

// La misma marca para los movimientos manuales, que no cuelgan de ninguna orden y
// si no quedarían acumulándose turno a turno cada vez que se resiembra. Se ve en el
// panel, y está bien que se vea: es plata de prueba.
const MARCA = "[seed-caja]";

/**
 * Los escenarios. Cada uno existe porque ejercita algo distinto de la caja, y el
 * comentario dice qué: sin eso, dentro de un mes esto es una lista de datos lindos
 * y nadie sabe cuál se puede borrar.
 *
 * `lineas[].variante` es un índice sobre el catálogo que se elija del tenant (ver
 * `elegirVariantes`), no un SKU: así el script corre igual en cualquier tenant.
 */
const ESCENARIOS = [
  {
    titulo: "NEW en efectivo, sin cobrar",
    porQue:
      "el botón Cobrar del panel: al confirmarla tiene que aparecer un ingreso en efectivo en el turno",
    lineas: [{ variante: 0, cantidad: 2 }, { variante: 1, cantidad: 1 }],
    paymentMethod: "CASH",
    fulfillmentMethod: "PICKUP",
    pasos: [],
  },
  {
    titulo: "NEW por transferencia, sin confirmar",
    porQue:
      "confirmar la transferencia mueve DOS cosas a la vez: anota el ingreso en la caja y la orden entra sola a producción",
    lineas: [{ variante: 2, cantidad: 3 }],
    paymentMethod: "TRANSFER",
    fulfillmentMethod: "DELIVERY",
    addressText: "Av. Libertador San Martín 1250, San Juan",
    addressDetails: "Portón negro, tocar timbre",
    pasos: [],
  },
  {
    titulo: "Transferencia confirmada (en producción)",
    porQue: "un ingreso por TRANSFERENCIA: suma al saldo de la cuenta, no al del cajón",
    lineas: [{ variante: 1, cantidad: 2 }],
    paymentMethod: "TRANSFER",
    fulfillmentMethod: "PICKUP",
    pasos: ["confirmarTransferencia"],
  },
  {
    titulo: "Mixta con la transferencia adentro y el efectivo pendiente",
    porQue:
      "la orden se destraba con la parte transferida, pero el efectivo recién entra al cajón cuando se entrega: es el caso donde la caja y el estado de la orden NO van juntos",
    lineas: [{ variante: 0, cantidad: 4 }, { variante: 3, cantidad: 2 }],
    paymentMethod: "MIXED",
    transferShare: 0.4,
    fulfillmentMethod: "DELIVERY",
    addressText: "Rivadavia 480, Rivadavia, San Juan",
    pasos: ["confirmarTransferencia"],
  },
  {
    titulo: "Efectivo entregado sin confirmar cobro previo",
    porQue:
      '"entregar es cobrar": completarla liquida sola lo que faltaba y ESE es el efectivo del mostrador que tiene que llegar al arqueo',
    lineas: [{ variante: 2, cantidad: 2 }],
    paymentMethod: "CASH",
    fulfillmentMethod: "PICKUP",
    pasos: ["completar"],
  },
  {
    titulo: "Mixta entregada (dos movimientos, uno por vía)",
    porQue:
      "un movimiento por FILA del libro: la mixta cerrada deja un ingreso en el cajón y otro en la cuenta, nunca uno solo por el total",
    lineas: [{ variante: 3, cantidad: 3 }, { variante: 1, cantidad: 1 }],
    paymentMethod: "MIXED",
    transferShare: 0.3,
    fulfillmentMethod: "DELIVERY",
    addressText: "Sarmiento 95 sur, Capital, San Juan",
    pasos: ["confirmarTransferencia", "listo", "completar"],
  },
  {
    titulo: "Cobrada, cancelada y devuelta",
    porQue:
      "la devolución RESTA del arqueo y aparece bajo la etiqueta Devolución — no se compensa contra Venta dejando el reporte mudo",
    lineas: [{ variante: 0, cantidad: 1 }],
    paymentMethod: "CASH",
    fulfillmentMethod: "PICKUP",
    pasos: ["cobrar", "cancelar", "devolver"],
  },
  {
    titulo: "Cancelada sin que entrara plata",
    porQue:
      "no deja ningún movimiento, pero el cierre SÍ se la lleva (se archiva): es la que se cae del historial si alguien lo arma mirando los movimientos en vez del turno",
    lineas: [{ variante: 2, cantidad: 1 }],
    paymentMethod: "TRANSFER",
    fulfillmentMethod: "PICKUP",
    pasos: ["cancelar"],
  },
  {
    titulo: "Cobrada por MercadoPago",
    porQue:
      "GATEWAY no pasa por el mostrador: la orden queda cobrada y el arqueo NO se mueve. Si esta plata aparece en el cajón, el enganche está mal",
    lineas: [{ variante: 1, cantidad: 2 }],
    paymentMethod: "CASH",
    fulfillmentMethod: "PICKUP",
    pasos: ["cobrarPorGateway"],
  },
];

/**
 * Los gastos y aportes del local. Sin esto el turno solo tiene ventas, y el arqueo
 * no prueba nada: lo que hay que ver es el esperado bajando por los egresos.
 * `categoria` es la `key` del catálogo por defecto (ver DEFAULT_CASH_CATEGORIES).
 */
// Los montos son chicos a propósito: tienen que quedar por debajo de lo que
// venden los pedidos de acá arriba. Un gasto más grande que las ventas deja el
// esperado del cajón en negativo, y entonces el turno arranca con la advertencia
// puesta — que es un caso real, pero no el que uno quiere ver cada vez que siembra.
const MOVIMIENTOS_MANUALES = [
  { categoria: "sueldos", type: "EXPENSE", channel: "CASH", amount: 4500, payee: "Carla — jornada" },
  { categoria: "insumos", type: "EXPENSE", channel: "CASH", amount: 1850, payee: "Distribuidora San Juan" },
  { categoria: "proveedores", type: "EXPENSE", channel: "TRANSFER", amount: 6200, payee: "Chocolatería del Centro" },
  { categoria: "aporte-cambio", type: "INCOME", channel: "CASH", amount: 1500, note: "Cambio para el fin de semana" },
  { categoria: "retiro", type: "EXPENSE", channel: "CASH", amount: 3000, note: "Retiro del dueño" },
];

const plata = (n) =>
  `$${Number(n ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ─── Pasos ───────────────────────────────────────────────────────────────────
// Cada uno es una llamada al service real, igual que la haría el panel. Reciben y
// devuelven la orden fresca porque el paso siguiente decide sobre el estado nuevo.

const PASOS = {
  async cobrar({ tenantId, orderId, adminId }) {
    return OrderModel.confirmPayment({ tenantId, orderId, confirmedById: adminId });
  },

  async confirmarTransferencia({ tenantId, orderId, adminId }) {
    return OrderModel.confirmTransfer({ tenantId, orderId, confirmedById: adminId });
  },

  async listo({ tenantId, orderId, adminId }) {
    return OrderModel.updateOrderStatus({
      tenantId,
      orderId,
      status: "READY",
      changedById: adminId,
    });
  },

  async completar({ tenantId, orderId, adminId }) {
    return OrderModel.updateOrderStatus({
      tenantId,
      orderId,
      status: "COMPLETED",
      changedById: adminId,
    });
  },

  async cancelar({ tenantId, orderId, adminId }) {
    return OrderModel.updateOrderStatus({
      tenantId,
      orderId,
      status: "CANCELLED",
      changedById: adminId,
      note: "Cancelada por el cliente",
    });
  },

  async devolver({ tenantId, orderId, adminId }) {
    // Se devuelve lo que efectivamente entró, no el total: devolver de más lo
    // rechaza el service (REFUND_EXCEEDS_PAID) y con razón.
    const { summary } = await OrderModel.getPayments({ tenantId, orderId });

    return OrderModel.registerPayment({
      tenantId,
      orderId,
      kind: "REFUND",
      channel: "CASH",
      amount: summary.paid,
      note: "Devolución por cancelación",
      actorId: adminId,
    });
  },

  async cobrarPorGateway({ tenantId, orderId, adminId, order }) {
    return OrderModel.registerPayment({
      tenantId,
      orderId,
      kind: "PAYMENT",
      channel: "GATEWAY",
      amount: order.total,
      note: "Pagado con MercadoPago",
      actorId: adminId,
    });
  },
};

// ─── Armado ──────────────────────────────────────────────────────────────────

/**
 * El catálogo con el que se arman los pedidos: variantes activas, de productos
 * PRODUCTO (los COMBO entran por otra puerta del carrito) y con stock de sobra —
 * completar una orden descuenta stock, y una demo que se cae por falta de stock no
 * prueba nada de la caja.
 */
async function elegirVariantes(tenantId, cantidad) {
  const variantes = await prisma.productVariant.findMany({
    where: {
      tenantId,
      isActive: true,
      stock: { gte: 15 },
      product: { isActive: true, type: "PRODUCTO" },
    },
    include: { product: { select: { id: true, name: true } } },
    orderBy: { id: "asc" },
    take: cantidad,
  });

  if (!variantes.length) {
    throw new Error(
      "El tenant no tiene productos con stock para armar pedidos. Corré primero el seed del catálogo."
    );
  }

  return variantes;
}

/** Checkout real: carrito + `OrderModel.create`, la misma puerta que el storefront. */
async function crearOrden({ tenant, customerId, escenario, variantes }) {
  // El carrito es de UN usuario: si quedó algo de la orden anterior (o de una
  // corrida que se cortó), la orden nueva saldría con items de más.
  await CartModel.clear({ tenantId: tenant.id, userId: customerId }).catch(() => {});

  for (const linea of escenario.lineas) {
    const variante = variantes[linea.variante % variantes.length];
    for (let i = 0; i < linea.cantidad; i += 1) {
      await CartModel.add({
        tenantId: tenant.id,
        userId: customerId,
        productId: variante.productId,
        variantId: variante.id,
      });
    }
  }

  // MIXED se pacta en dos tiempos a propósito: el desglose tiene que sumar EXACTO
  // el total, y el total lo calcula el server recién en el checkout (hay promo por
  // cantidad de por medio, así que no se puede adivinar sumando precios). Así que
  // la orden nace en efectivo y el método real se fija en la revisión, que es la
  // misma puerta por la que lo hace el panel con un pedido del bot.
  const orden = await OrderModel.create({
    tenantId: tenant.id,
    userId: customerId,
    fulfillmentMethod: escenario.fulfillmentMethod,
    addressText: escenario.addressText,
    addressDetails: escenario.addressDetails,
    paymentMethod: escenario.paymentMethod === "MIXED" ? "CASH" : escenario.paymentMethod,
  });

  await prisma.order.update({
    where: { id: orden.id },
    data: { paymentId: `${TAG}${Date.now()}` },
  });

  if (escenario.paymentMethod !== "MIXED") return orden;

  const transferAmount = roundMoney(orden.total * (escenario.transferShare ?? 0.5));

  return OrderModel.reviewOrder({
    tenantId: tenant.id,
    orderId: orden.id,
    reviewedById: null,
    fulfillment: {
      paymentMethod: "MIXED",
      transferAmount,
      cashAmount: roundMoney(orden.total - transferAmount),
      paymentNote: `Transfiere ${plata(transferAmount)}, el resto en efectivo al entregar`,
    },
  });
}

/**
 * Si el tenant cobra seña, la orden no produce hasta que esté confirmada. Se
 * resuelve acá y no en cada escenario para que el script sirva igual en un tenant
 * con seña prendida — y de paso siembra un movimiento `ORDER_DEPOSIT`, que es el
 * tercer tipo que la caja anota desde el libro.
 */
async function asegurarSeña({ tenantId, orderId, adminId }) {
  const orden = await prisma.order.findUnique({
    where: { id: orderId },
    select: { requiresDeposit: true, paymentStatus: true, paymentMethod: true },
  });

  if (!orden?.requiresDeposit || orden.paymentStatus !== "PENDING") return null;

  return OrderModel.confirmDeposit({
    tenantId,
    orderId,
    confirmedById: adminId,
    channel: orden.paymentMethod === "CASH" ? "CASH" : "TRANSFER",
  });
}

const PASOS_QUE_PRODUCEN = new Set(["listo", "completar"]);

async function correrEscenario({ tenant, customerId, adminId, escenario, variantes }) {
  let orden = await crearOrden({ tenant, customerId, escenario, variantes });

  for (const paso of escenario.pasos) {
    if (PASOS_QUE_PRODUCEN.has(paso)) {
      await asegurarSeña({ tenantId: tenant.id, orderId: orden.id, adminId });
    }

    await PASOS[paso]({ tenantId: tenant.id, orderId: orden.id, adminId, order: orden });

    orden = await prisma.order.findUnique({ where: { id: orden.id } });
  }

  return orden;
}

// ─── Turno ───────────────────────────────────────────────────────────────────

/**
 * El turno donde va a caer todo. Se respeta el que ya esté abierto: pisarlo sería
 * exactamente lo que la caja no permite (y lo que arruinaría un arqueo en curso).
 */
async function asegurarTurno({ tenantId, adminId, apertura }) {
  // Primero el camino real: si el tenant tiene horario, el turno lo abre solo — el
  // mismo llamado que hace un cobro. También cierra el que quedó vencido de ayer.
  await CashRegisterModel.ensureScheduledSession({ tenantId, actorId: adminId });

  const abierta = await prisma.cashRegisterSession.findFirst({
    where: { tenantId, status: "OPEN" },
  });

  if (abierta) {
    console.log(
      `  -> se usa el turno #${abierta.id} que ya estaba abierto` +
        `${abierta.label ? ` (${abierta.label})` : ""}, apertura ${plata(abierta.openingAmount)}`
    );
    return abierta;
  }

  const sesion = await CashRegisterModel.open({
    tenantId,
    openingAmount: apertura,
    openingTransferAmount: 0,
    openedById: adminId,
    note: "Apertura del script de prueba de caja",
  });

  console.log(`  -> turno #${sesion.id} abierto con ${plata(sesion.openingAmount)} en el cajón`);
  return sesion;
}

async function cargarMovimientosManuales({ tenantId, adminId }) {
  const categorias = await prisma.cashCategory.findMany({
    where: { tenantId },
    select: { id: true, key: true, label: true },
  });
  const porKey = new Map(categorias.map((c) => [c.key, c]));

  let cargados = 0;

  for (const movimiento of MOVIMIENTOS_MANUALES) {
    const categoria = porKey.get(movimiento.categoria);

    // El tenant es dueño de sus etiquetas: puede haber borrado "retiro" o no tener
    // sembrado el catálogo por defecto. Se saltea y se avisa, no se le inventa una.
    if (!categoria) {
      console.log(`  -> sin etiqueta "${movimiento.categoria}", se saltea ese movimiento`);
      continue;
    }

    await CashRegisterModel.addMovement({
      tenantId,
      type: movimiento.type,
      channel: movimiento.channel,
      amount: movimiento.amount,
      categoryId: categoria.id,
      payee: movimiento.payee ?? null,
      note: [movimiento.note, MARCA].filter(Boolean).join(" "),
      createdById: adminId,
    });

    cargados += 1;
  }

  return cargados;
}

// ─── Reset ───────────────────────────────────────────────────────────────────

/**
 * Borra SOLO lo que sembró este script: las órdenes marcadas con `TAG`, los
 * movimientos que esos cobros generaron y los manuales marcados con `MARCA`. No
 * toca turnos, ni una sola orden real, ni un movimiento que haya cargado alguien.
 *
 * Los movimientos de orden van a mano porque `CashMovement.orderId` no tiene FK a
 * propósito (es un hecho histórico de caja, ver el schema): borrar la orden los
 * dejaría colgados sumando plata que ya no existe.
 *
 * Los manuales se borran solo de turnos ABIERTOS. Un turno cerrado tiene el arqueo
 * firmado en columnas propias —no se recalcula— así que vaciarle los movimientos lo
 * dejaría diciendo un total que nada explica.
 */
async function resetear(tenantId) {
  const ordenes = await prisma.order.findMany({
    where: { tenantId, paymentId: { startsWith: TAG } },
    select: { id: true },
  });

  const ids = ordenes.map((o) => o.id);

  const enTurnosCerrados = ids.length
    ? await prisma.cashMovement.count({
        where: { tenantId, orderId: { in: ids }, session: { status: "CLOSED" } },
      })
    : 0;

  const { count: deOrdenes } = ids.length
    ? await prisma.cashMovement.deleteMany({ where: { tenantId, orderId: { in: ids } } })
    : { count: 0 };

  const { count: borradas } = ids.length
    ? await prisma.order.deleteMany({ where: { id: { in: ids } } })
    : { count: 0 };

  const { count: manuales } = await prisma.cashMovement.deleteMany({
    where: { tenantId, note: { endsWith: MARCA }, session: { status: "OPEN" } },
  });

  console.log(
    `  -> ${borradas} órdenes, ${deOrdenes} movimientos de cobro y ${manuales} manuales borrados`
  );

  if (enTurnosCerrados > 0) {
    console.log(
      `  OJO: ${enTurnosCerrados} de esos movimientos eran de un turno YA CERRADO. El arqueo\n` +
        "       firmado no cambia (es un snapshot), así que ese turno queda diciendo un total\n" +
        "       que sus movimientos ya no explican."
    );
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function seedCaja({ slug = DEFAULT_SLUG, reset = false, apertura = APERTURA_DEFAULT } = {}) {
  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true },
  });

  if (!tenant) {
    throw new Error(`Tenant "${slug}" no encontrado. Corré primero "pnpm seed".`);
  }

  const config = await prisma.tenantConfig.findUnique({
    where: { tenantId: tenant.id },
    select: { cashRegisterEnabled: true, paymentMethodsEnabled: true, fulfillmentMethodsEnabled: true },
  });

  if (!config?.cashRegisterEnabled) {
    throw new Error(
      `La caja de "${slug}" está apagada: sin el flag, los cobros no generan ningún movimiento.\n` +
        `   Prendela con:  node prisma/set-cash-register.js ${slug} on`
    );
  }

  const [admin, customer] = await Promise.all([
    prisma.user.findFirst({ where: { tenantId: tenant.id, role: "ADMIN" } }),
    prisma.user.findFirst({ where: { tenantId: tenant.id, role: "CUSTOMER" } }),
  ]);

  if (!admin || !customer) {
    throw new Error(`Faltan usuarios ADMIN/CUSTOMER de "${slug}" — corré primero "pnpm seed".`);
  }

  console.log(`== Caja de prueba: ${tenant.name} (${slug}) ==\n`);

  if (reset) {
    console.log("Borrando lo sembrado antes:");
    await resetear(tenant.id);
    console.log("");
  }

  // Un tenant con un perfil de venta acotado (solo efectivo, solo retiro) no puede
  // correr los escenarios de los métodos que no acepta: el checkout los rechaza. Se
  // saltean con el motivo a la vista en vez de reventar a mitad de camino.
  const habilitado = (lista, metodo) =>
    !Array.isArray(lista) || lista.length === 0 || lista.includes(metodo);

  const escenarios = ESCENARIOS.filter((escenario) => {
    const ok =
      habilitado(config.paymentMethodsEnabled, escenario.paymentMethod) &&
      habilitado(config.fulfillmentMethodsEnabled, escenario.fulfillmentMethod);

    if (!ok) {
      console.log(`  (se saltea "${escenario.titulo}": el tenant no acepta ese método)`);
    }

    return ok;
  });

  console.log("Turno:");
  const sesion = await asegurarTurno({ tenantId: tenant.id, adminId: admin.id, apertura });

  const variantes = await elegirVariantes(tenant.id, 4);
  console.log(`  -> catálogo: ${variantes.map((v) => v.sku).join(", ")}\n`);

  console.log("Órdenes:");
  const creadas = [];

  for (const escenario of escenarios) {
    const orden = await correrEscenario({
      tenant,
      customerId: customer.id,
      adminId: admin.id,
      escenario,
      variantes,
    });

    creadas.push({ escenario, orden });

    console.log(
      `  #${String(orden.id).padEnd(5)} ${orden.status.padEnd(11)} ${orden.paymentStatus.padEnd(13)} ` +
        `${(orden.paymentMethod ?? "-").padEnd(9)} ${plata(orden.total).padStart(14)}  ${escenario.titulo}`
    );
  }

  console.log("\nMovimientos del local (sueldos, insumos, retiros):");
  const manuales = await cargarMovimientosManuales({ tenantId: tenant.id, adminId: admin.id });
  console.log(`  -> ${manuales} cargados`);

  // El arqueo se lee por la misma vía que lo lee el panel, no recalculado acá: si
  // el número que imprime este script no fuera el mismo que muestra `GET /current`,
  // el script mentiría justo sobre lo que vino a probar.
  const actual = await CashRegisterModel.getCurrent({ tenantId: tenant.id, actorId: admin.id });
  const porTipo = {};

  for (const movimiento of actual.movements) {
    porTipo[movimiento.type] = (porTipo[movimiento.type] ?? 0) + 1;
  }

  console.log(`\n== Turno #${actual.id} ==`);
  console.log(`  movimientos:            ${actual.movements.length}  (${
    Object.entries(porTipo)
      .map(([tipo, n]) => `${tipo}: ${n}`)
      .join(", ") || "ninguno"
  })`);
  console.log(`  apertura cajón:         ${plata(actual.openingAmount)}`);
  console.log(`  esperado en el cajón:   ${plata(actual.totals.expectedCashAmount)}`);
  console.log(`  esperado en la cuenta:  ${plata(actual.totals.expectedTransferAmount)}`);
  console.log(
    `  el cierre archiva:      ${actual.ordersToClose?.toArchive ?? 0} órdenes ` +
      `(${actual.ordersToClose?.staysOpen ?? 0} siguen abiertas, ` +
      `${actual.ordersToClose?.unpaid ?? 0} entregadas sin terminar de cobrar)`
  );

  if (actual.totals.expectedNegative) {
    console.log("  OJO: el esperado del cajón dio NEGATIVO (faltaría registrar un ingreso)");
  }

  // Una cancelada también queda en PENDING y no se puede cobrar: ofrecerla como
  // "confirmala" sería mandar a alguien contra un 409.
  const sinCobrar = creadas.filter(
    ({ orden }) => orden.paymentStatus === "PENDING" && orden.status !== "CANCELLED"
  );

  console.log("\nPara probar a mano, desde el panel o por HTTP:");
  for (const { orden, escenario } of sinCobrar) {
    console.log(
      `  · orden #${orden.id} (${escenario.paymentMethod}) sigue sin cobrar — ` +
        `confirmala y el esperado tiene que subir ${plata(orden.total)}`
    );
  }
  console.log(`  · GET  /cash-register/current            → el arqueo en vivo`);
  console.log(`  · GET  /cash-register/${actual.id}/export${" ".repeat(Math.max(0, 12 - String(actual.id).length))}→ la planilla del turno`);
  console.log(
    `  · POST /cash-register/close              → firma el arqueo, archiva las órdenes terminales\n` +
      "                                            y abre el turno siguiente con lo contado"
  );

  return { sesionId: actual.id, ordenes: creadas.length, movimientos: actual.movements.length };
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const args = process.argv.slice(2);
  const slug = args.find((arg) => !arg.startsWith("--")) ?? DEFAULT_SLUG;
  const apertura = Number(
    args.find((arg) => arg.startsWith("--apertura="))?.split("=")[1] ?? APERTURA_DEFAULT
  );

  seedCaja({ slug, reset: args.includes("--reset"), apertura })
    .then(() => console.log("\nListo."))
    .catch((err) => {
      console.error(`\n${err.message ?? err}`);
      if (err.details) console.error(err.details);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeRedis();
      await prisma.$disconnect();
    });
}
