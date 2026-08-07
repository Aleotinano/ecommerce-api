import prisma from "../lib/prisma.js";
import { createError } from "../helpers/error.js";
import { roundMoney } from "../helpers/price.js";
import {
  CASH_MOVEMENT_SIGN,
  MANUAL_MOVEMENT_TYPES,
  buildArqueo,
  isExpectedNegative,
  summarizeMovements,
} from "./cash-register-math.js";
import {
  buildPeriodXlsx,
  buildSessionXlsx,
  periodFileName,
  sessionFileName,
} from "./cash-register-export.js";
import {
  expiredByMinutes,
  isExpired,
  nextShiftStart,
  shiftExpiry,
  shiftFor,
  shouldAutoClose,
} from "./cash-register-schedule.js";
import { archiveTerminalOrders, summarizeArchivable } from "./order-archive.js";

/**
 * Caja registradora: el turno de caja física del local.
 *
 * Registra con cuánto efectivo se abre el día, qué entró y qué salió durante el
 * turno (los cobros de las órdenes van solos; sueldos, insumos y retiros se cargan
 * a mano), con cuánto se cierra, y **cuánta diferencia hubo** entre lo que el
 * sistema esperaba y lo que la persona contó.
 *
 * La caja NO es un día calendario: es un turno explícito (apertura → cierre). Eso
 * evita por completo el problema de zona horaria que tiene `services/stats` para
 * definir "hoy".
 *
 * El software sigue sin gestionar dinero: no verifica que la plata exista, igual
 * que las confirmaciones de cobro de una orden. Lleva la cuenta de lo que un
 * humano declaró y muestra el desvío.
 *
 * Opt-in por tenant (`TenantConfig.cashRegisterEnabled`): con el flag apagado
 * —todos los tenants hasta que lo prendamos— este módulo no existe.
 */

// Catálogo de arranque, para que un tenant recién habilitado no vea una pantalla
// vacía. Son los rubros que aparecieron hablando con el primer cliente: sueldos e
// insumos son los dos que pidió por nombre. El tenant después agrega los suyos:
// las etiquetas SÍ son de él (son su taxonomía, no una regla de plata).
export const DEFAULT_CASH_CATEGORIES = [
  { key: "sueldos", label: "Sueldos", applies: "EXPENSE", position: 0 },
  { key: "insumos", label: "Insumos", applies: "EXPENSE", position: 1 },
  { key: "proveedores", label: "Proveedores", applies: "EXPENSE", position: 2 },
  { key: "servicios", label: "Servicios", applies: "EXPENSE", position: 3 },
  { key: "retiro", label: "Retiro de caja", applies: "EXPENSE", position: 4 },
  { key: "aporte-cambio", label: "Aporte de cambio", applies: "INCOME", position: 5 },
  // El turno se abre en 0 y el fondo del cajón entra como un ingreso etiquetado:
  // así la plata de la apertura tiene motivo y aparece en el resumen por etiqueta,
  // en vez de quedar escondida en el `openingAmount` de la sesión.
  { key: "apertura", label: "Apertura", applies: "INCOME", position: 6 },
  { key: "ajuste", label: "Ajuste", applies: "BOTH", position: 7 },
];

/**
 * Etiquetas RESERVADAS: las escribe el enganche con el libro de cobros, no una
 * persona. Existen para que el resumen por etiqueta cubra el **100%** de la plata —
 * antes los movimientos de orden entraban sin etiqueta y ese eje no sumaba al neto.
 *
 * Van separadas por `applies` en vez de una sola con `BOTH` para que el reporte diga
 * "Venta 850.000 / Devolución −2.000" y no un neto de 848.000, donde la devolución
 * desaparece.
 */
export const SYSTEM_CASH_CATEGORIES = [
  { key: "venta", label: "Venta", applies: "INCOME", position: 90 },
  { key: "devolucion", label: "Devolución", applies: "EXPENSE", position: 91 },
];

/** Qué etiqueta reservada le toca a cada tipo de movimiento de orden. */
const ORDER_TYPE_TO_CATEGORY = {
  ORDER_DEPOSIT: "venta",
  ORDER_PAYMENT: "venta",
  ORDER_REFUND: "devolucion",
};

const CATEGORY_FIELDS = {
  id: true,
  key: true,
  label: true,
  applies: true,
  position: true,
  isActive: true,
  isSystem: true,
};

/**
 * Las etiquetas reservadas del tenant, creándolas si faltan. Idempotente y
 * self-healing: un tenant que habilitó la caja antes de que existieran las recibe
 * igual la primera vez que cobra, sin que nadie corra nada.
 */
async function ensureSystemCategories(tenantId, client = prisma) {
  const rows = [];

  for (const category of SYSTEM_CASH_CATEGORIES) {
    rows.push(
      await client.cashCategory.upsert({
        where: { tenantId_key: { tenantId, key: category.key } },
        create: { tenantId, ...category, isSystem: true },
        // No se toca lo que ya existe: el tenant puede haber renombrado "Venta" a
        // "Ingreso por pedidos", y ese nombre es suyo.
        update: {},
        select: CATEGORY_FIELDS,
      })
    );
  }

  return new Map(rows.map((row) => [row.key, row]));
}

const MOVEMENT_INCLUDE = {
  include: { category: { select: CATEGORY_FIELDS } },
};

/**
 * Las órdenes que el turno se llevó al cerrar, tal como se listan en su ficha.
 *
 * `select` acotado a propósito: esto es una lista de lectura —"qué se vendió ese
 * día"—, no el detalle. Para eso está `GET /orders/:id`, que no filtra por
 * `archivedAt` y sigue abriendo una orden archivada entera.
 *
 * Se busca por `Order.cashSessionId` y NO por `CashMovement.orderId`: el movimiento
 * existe solo si hubo un cobro por el cajón, así que una cancelada, una de
 * MercadoPago (`GATEWAY` se saltea a propósito) o una entregada sin cobrar se
 * caerían del historial justo cuando son las que hay que mirar.
 */
const SESSION_ORDER_SELECT = {
  id: true,
  status: true,
  total: true,
  paymentStatus: true,
  createdAt: true,
  contactName: true,
  user: { select: { id: true, username: true } },
};

/**
 * Movimientos que la caja anota a partir del libro de cobros de una orden. Ver
 * `recordOrderPayments`.
 */
const ORDER_KIND_TO_TYPE = {
  DEPOSIT: "ORDER_DEPOSIT",
  PAYMENT: "ORDER_PAYMENT",
  REFUND: "ORDER_REFUND",
};

/**
 * 404 si el tenant no tiene la caja habilitada: para él el módulo no existe, no es
 * que le falten permisos. Se lee siempre de la base y no del cache de
 * `TenantConfigModel.get` (TTL 600 s) porque de este flag depende un guard.
 */
async function assertEnabled(tenantId, client = prisma) {
  const config = await client.tenantConfig.findUnique({
    where: { tenantId },
    select: { cashRegisterEnabled: true },
  });

  if (!config?.cashRegisterEnabled) {
    throw createError(
      "El módulo de caja no está habilitado para esta tienda",
      "CASH_REGISTER_DISABLED",
      404
    );
  }
}

/** El turno abierto del tenant, o null. Sin movimientos: para los guards alcanza. */
function findOpenSession(tenantId, client = prisma) {
  return client.cashRegisterSession.findFirst({
    where: { tenantId, status: "OPEN" },
  });
}

/**
 * Turno abierto o 409. Es el guard que hace que un movimiento no pueda caer fuera
 * de un turno: si pudiera, el arqueo del día quedaría siempre mal y nadie sabría
 * por qué.
 */
async function requireOpenSession(tenantId, client = prisma) {
  const session = await findOpenSession(tenantId, client);

  if (!session) {
    throw createError(
      "No hay una caja abierta",
      "CASH_SESSION_NOT_OPEN",
      409
    );
  }

  return session;
}

/** Rango opcional sobre `createdAt`/`openedAt`, con el patrón de services/stats. */
function dateRange(from, to) {
  if (!from && !to) return undefined;
  return { ...(from && { gte: from }), ...(to && { lte: to }) };
}

/** Vías que sí pasan por el cajón: `GATEWAY` (MercadoPago) no. */
export function hasCashChannels(entries = []) {
  return entries.some((entry) => entry.channel !== "GATEWAY");
}

/**
 * Con cuánto abre el turno siguiente: **con lo que quedó al cerrar el anterior**, en
 * el cajón y en la cuenta. La caja es una sola y continua —la fuente de todo el
 * capital del local—, así que los saldos no se declaran de nuevo cada vez.
 *
 * Se mira el ÚLTIMO turno cerrado, contara o no. Cuando nadie contó
 * (`closedWithoutCount`) se arrastra el **esperado**, que el sistema sí calculó: la
 * plata siguió físicamente ahí, y saltear ese turno para buscar el último arqueo
 * firmado —que puede ser de días atrás— borraba del saldo todo lo que pasó en el
 * medio. El turno queda marcado igual como cerrado sin contar; lo que no se hace es
 * mentir sobre el saldo.
 *
 * En transferencias hay un fallback más: los turnos cerrados ANTES de que existiera
 * el saldo de transferencias no tienen `expectedTransferAmount`, y ahí lo más
 * parecido que hay es su neto del turno (`transferTotal`).
 *
 * Un tenant que recién empieza no tiene ningún cierre: ahí sí abre en 0.
 *
 * @returns {Promise<{cash: number, transfer: number}>}
 */
async function carryOverAmount(tenantId, client = prisma) {
  const ultima = await client.cashRegisterSession.findFirst({
    where: { tenantId, status: "CLOSED" },
    orderBy: { closedAt: "desc" },
    select: {
      pettyCashAmount: true,
      countedCashAmount: true,
      expectedCashAmount: true,
      countedTransferAmount: true,
      expectedTransferAmount: true,
      transferTotal: true,
    },
  });

  return {
    // La caja chica manda: es la plata que QUEDÓ en el cajón. Lo contado incluye lo
    // que la persona se llevó, así que arrastrarlo ofrecería plata que ya no está.
    // El fallback cubre los cierres anteriores a que existiera el retiro.
    cash: roundMoney(
      Number(
        ultima?.pettyCashAmount ??
          ultima?.countedCashAmount ??
          ultima?.expectedCashAmount ??
          0
      )
    ),
    transfer: roundMoney(
      Number(
        ultima?.countedTransferAmount ??
          ultima?.expectedTransferAmount ??
          ultima?.transferTotal ??
          0
      )
    ),
  };
}

/**
 * Crea la sesión abierta del tenant, materializando el turno del horario que le
 * corresponde al momento en que se abre.
 *
 * `label` y `expiresAt` quedan CONGELADOS acá a propósito: editar el horario mañana
 * no puede mover el vencimiento de un turno que ya está corriendo.
 *
 * Fuera de horario —lo típico al cerrar el día 20:05 cuando el turno terminaba
 * 20:00— la caja se abre igual, sin etiqueta, y vence cuando arranca el próximo
 * turno. Abrir igual es deliberado: con la caja cerrada el backend bloquea los cobros
 * en efectivo, y una caja que nadie reabre frena la venta. El vencimiento es lo que
 * después deja que `shouldAutoClose` la levante en vez de dejarla juntando días.
 */
function createSession(
  client,
  {
    tenantId,
    openingAmount,
    openingTransferAmount = 0,
    openedById,
    now,
    schedule,
    trigger,
    note,
  }
) {
  const turno = shiftFor(now, schedule);

  return client.cashRegisterSession.create({
    data: {
      tenantId,
      openingAmount: roundMoney(Number(openingAmount)),
      openingTransferAmount: roundMoney(Number(openingTransferAmount)),
      openedById,
      openedAt: now,
      trigger,
      label: turno?.label ?? null,
      expiresAt: turno ? shiftExpiry(now, turno) : nextShiftStart(now, schedule),
      openingNote: note,
    },
  });
}

/** El horario de turnos del tenant. `null` = sin horario: la caja es 100% a mano. */
async function getSchedule(tenantId, client = prisma) {
  const config = await client.tenantConfig.findUnique({
    where: { tenantId },
    select: { cashSchedule: true },
  });

  return config?.cashSchedule ?? null;
}

export const CashRegisterModel = {
  // ── Turno ────────────────────────────────────────────────────────────────

  /**
   * El turno abierto con sus movimientos y los totales EN VIVO (lo que debería
   * haber en el cajón ahora mismo).
   *
   * Devuelve `null` si no hay ninguno abierto, y el controller responde 200: "no
   * hay caja abierta" es un estado normal de la operación, no un error — el panel
   * tiene que poder pintar el botón de abrir.
   */
  async getCurrent({ tenantId, actorId = null }) {
    await assertEnabled(tenantId);

    // Abrir el turno al pedir el tablero es parte de la apertura automática: el
    // panel es el otro momento —además del cobro— en que alguien "toca" la caja.
    await this.ensureScheduledSession({ tenantId, actorId });

    const session = await prisma.cashRegisterSession.findFirst({
      where: { tenantId, status: "OPEN" },
      include: {
        movements: { ...MOVEMENT_INCLUDE, orderBy: { createdAt: "asc" } },
      },
    });

    if (!session) return null;

    const [orders, ordersToClose] = await Promise.all([
      // Normalmente vacío: el turno abierto todavía no archivó nada. Se llena si
      // alguien archivó una orden a mano durante el turno.
      prisma.order.findMany({
        where: { tenantId, cashSessionId: session.id },
        select: SESSION_ORDER_SELECT,
        orderBy: { createdAt: "asc" },
      }),
      // Qué se va a llevar el cierre. Va acá y no solo en la respuesta del POST
      // porque el formulario lo muestra ANTES de firmar: "3 órdenes quedan abiertas"
      // es la última chance de notar que un pedido nunca se marcó entregado.
      summarizeArchivable(prisma, { tenantId }),
    ]);

    return {
      ...session,
      vencido: isExpired(session),
      vencidoHaceMinutos: expiredByMinutes(session),
      orders,
      ordersToClose,
      totals: buildArqueo({
        openingAmount: session.openingAmount,
        openingTransferAmount: session.openingTransferAmount,
        movements: session.movements,
      }),
    };
  },

  /**
   * Abre el turno que corresponde al horario del tenant, si hace falta. Es la
   * apertura automática, y **se resuelve en el momento** (no hay job): la llaman el
   * enganche de cobros y `GET /current`.
   *
   * Tres cosas en orden:
   *  1. si hay un turno abierto que ya venció, que pasó la gracia y cuyo turno ya no
   *     es el actual, se cierra **sin conteo** — es lo que evita que un turno quede
   *     colgado juntando los cobros de tres días;
   *  2. si queda un turno abierto (en horario, o vencido dentro de la gracia), se
   *     devuelve ese;
   *  3. si no hay ninguno y el horario dice que estamos en turno, se abre con el
   *     arrastre del cierre anterior.
   *
   * Devuelve `null` cuando no corresponde abrir nada (sin caja, sin horario, o
   * fuera de horario): ahí el guard de "caja abierta" sigue valiendo igual.
   */
  async ensureScheduledSession({ tenantId, actorId = null, now = new Date() }) {
    const config = await prisma.tenantConfig.findUnique({
      where: { tenantId },
      select: { cashRegisterEnabled: true, cashSchedule: true },
    });

    if (!config?.cashRegisterEnabled) return null;

    const schedule = config.cashSchedule;
    const abierta = await findOpenSession(tenantId);

    if (abierta) {
      if (!shouldAutoClose(abierta, { now, schedule })) return abierta;

      await this.closeWithoutCount({
        tenantId,
        sessionId: abierta.id,
        actorId,
        note: `Cerrado por el sistema: venció el ${abierta.label ?? "turno"} y nadie lo cerró`,
      });
    }

    const turno = shiftFor(now, schedule);
    if (!turno) return null;

    const arrastre = await carryOverAmount(tenantId);

    try {
      return await createSession(prisma, {
        tenantId,
        openingAmount: arrastre.cash,
        openingTransferAmount: arrastre.transfer,
        openedById: actorId,
        now,
        schedule,
        trigger: "AUTO",
        note: `Apertura automática (${turno.label}), arrastre del cierre anterior`,
      });
    } catch (error) {
      // Dos cobros simultáneos entrando al mismo turno: el índice único parcial deja
      // pasar uno solo y el otro se cuelga del que ganó.
      if (error.code === "P2002") return findOpenSession(tenantId);
      throw error;
    }
  },

  /**
   * Cierra un turno **sin arqueo**: el sistema no puede contar la plata, así que
   * `countedCashAmount` y `cashDifference` quedan en `null` y la fila queda marcada
   * con `closedWithoutCount`. "Nunca se contó" y "se contó y no cuadró" son cosas
   * distintas, y un cierre en cero mentiría diciendo que cuadró.
   *
   * `expectedCashAmount`/`transferTotal` sí se guardan: eso el sistema lo sabe.
   *
   * Archiva las órdenes terminales igual que el cierre con arqueo: un turno que se
   * venció y nadie cerró terminó lo mismo, y si este camino no archivara, un local
   * que nunca cierra la caja a mano no vería limpiarse el tablero jamás.
   */
  async closeWithoutCount({ tenantId, sessionId, actorId = null, note = null }) {
    return prisma.$transaction(async (tx) => {
      const session = await tx.cashRegisterSession.findFirst({
        where: { id: sessionId, tenantId, status: "OPEN" },
      });

      if (!session) {
        throw createError("No hay una caja abierta", "CASH_SESSION_NOT_OPEN", 409);
      }

      const movements = await tx.cashMovement.findMany({
        where: { sessionId: session.id },
      });

      const arqueo = buildArqueo({
        openingAmount: session.openingAmount,
        openingTransferAmount: session.openingTransferAmount,
        movements,
      });

      const closedAt = new Date();

      const closed = await tx.cashRegisterSession.update({
        where: { id: session.id },
        data: {
          status: "CLOSED",
          closedById: actorId,
          closedAt,
          closingNote: note,
          closedWithoutCount: true,
          // Lo que el sistema SÍ sabe, en los dos saldos. Lo contado queda en null:
          // nadie contó ni el cajón ni el banco.
          expectedCashAmount: arqueo.expectedCashAmount,
          transferTotal: arqueo.transferTotal,
          expectedTransferAmount: arqueo.expectedTransferAmount,
        },
      });

      const archivedOrders = await archiveTerminalOrders(tx, {
        tenantId,
        sessionId: session.id,
        actorId,
        at: closedAt,
      });

      return { ...closed, archivedOrders };
    });
  },

  /**
   * Abre el turno con los saldos declarados: el efectivo del cajón y lo que hay en
   * la cuenta.
   *
   * **El saldo que no venga abre con el arrastre** del cierre anterior, igual que la
   * apertura automática: la caja es continua, y una apertura a mano que arranca en 0
   * borraba de un plumazo la plata que quedó. Mandar `0` explícito sigue siendo
   * válido —un local que arranca con el cajón vacío es un caso real—, y el panel
   * manda lo que muestran los campos.
   *
   * El 409 sale de dos lugares a propósito: el `findFirst` da el error lindo en el
   * caso normal, y el catch del índice único parcial
   * (`CashRegisterSession_tenant_open_key`) cubre la carrera de dos requests
   * simultáneos — que es justo el escenario donde dos turnos abiertos dejarían el
   * arqueo sin sentido.
   */
  async open({
    tenantId,
    openingAmount,
    openingTransferAmount,
    note = null,
    openedById,
  }) {
    await assertEnabled(tenantId);

    const abierta = await findOpenSession(tenantId);

    if (abierta) {
      const error = createError(
        "Ya hay una caja abierta",
        "CASH_SESSION_ALREADY_OPEN",
        409
      );
      error.details = { sessionId: abierta.id, openedAt: abierta.openedAt };
      throw error;
    }

    // Se lee el arrastre solo si falta alguno de los dos: es una query de más que no
    // hace falta cuando el panel manda los dos montos (el caso normal).
    const faltaAlguno =
      openingAmount == null || openingTransferAmount == null;
    const arrastre = faltaAlguno
      ? await carryOverAmount(tenantId)
      : { cash: 0, transfer: 0 };

    try {
      return await createSession(prisma, {
        tenantId,
        openingAmount: openingAmount ?? arrastre.cash,
        openingTransferAmount: openingTransferAmount ?? arrastre.transfer,
        openedById,
        now: new Date(),
        schedule: await getSchedule(tenantId),
        trigger: "MANUAL",
        note,
      });
    } catch (error) {
      if (error.code === "P2002") {
        throw createError(
          "Ya hay una caja abierta",
          "CASH_SESSION_ALREADY_OPEN",
          409
        );
      }
      throw error;
    }
  },

  /**
   * Cierra el turno con lo contado a mano y guarda el arqueo de los DOS saldos.
   *
   * Los totales quedan como SNAPSHOT: no se recalculan nunca más (mismo criterio que
   * `Order.depositAmount`). Si mañana se corrige un movimiento viejo, el arqueo de
   * ayer tiene que seguir diciendo lo que dijo cuando se firmó.
   *
   * `countedTransferAmount` es OPCIONAL: contar el banco al cerrar no siempre pasa, y
   * sin ese número la diferencia de transferencias queda en `null` —no en 0— para no
   * firmar un cuadre que nadie verificó. El saldo igual continúa: la caja siguiente
   * arrastra el esperado.
   *
   * **Cerrar el turno cierra el día también para las órdenes**: las terminales se
   * archivan acá, en la misma transacción (ver services/order-archive.js). Las que
   * siguen abiertas no se tocan y pasan al turno siguiente.
   *
   * **Y la caja sigue**: cerrar firma el arqueo y abre en el acto el turno siguiente,
   * en la MISMA transacción (`reopen`, por defecto `true`). La caja del local es una
   * sola y continua; dejarla cerrada esperando que alguien la vuelva a abrir significa
   * bloquear los cobros en efectivo mientras tanto. Para el fin de temporada está
   * `reopen: false`, la acción explícita de dejar la caja cerrada.
   *
   * **Con qué sigue**: con la CAJA CHICA, no con lo contado. `withdrawnCashAmount` es
   * lo que la persona se lleva del cajón al cerrar (la "caja grande") y el resto queda
   * para arrancar mañana. Sin retiro declarado los dos números coinciden y el
   * comportamiento es el de siempre.
   */
  async close({
    tenantId,
    countedCashAmount,
    countedTransferAmount = null,
    withdrawnCashAmount = 0,
    note = null,
    closedById,
    reopen = true,
  }) {
    await assertEnabled(tenantId);

    // No se puede retirar más de lo que se contó: sería dejar el cajón en negativo por
    // una cuenta mal hecha, no por un movimiento sin registrar (que es el único
    // negativo que la caja acepta). Va antes de la transacción: es aritmética sobre lo
    // que mandó el request, no depende de nada de la base.
    const retirado = roundMoney(Number(withdrawnCashAmount ?? 0));
    if (retirado > roundMoney(Number(countedCashAmount))) {
      const error = createError(
        "No podés retirar más de lo que contaste",
        "CASH_WITHDRAWAL_EXCEEDS_COUNT",
        409
      );
      error.details = { countedCashAmount, withdrawnCashAmount: retirado };
      throw error;
    }

    // Fuera de la transacción: es una lectura de configuración y no queremos el
    // roundtrip adentro. Lo único que decide es la etiqueta del turno que se abre.
    const schedule = reopen ? await getSchedule(tenantId) : null;

    return prisma.$transaction(async (tx) => {
      const session = await requireOpenSession(tenantId, tx);

      // Con la etiqueta incluida: sin el include, el `summary.byCategory` de la
      // respuesta salía con `label: null` y con el id como clave, mientras que el de
      // `GET /:id` traía slug y nombre. Dos formas para el mismo campo obligaban al
      // panel a ignorar este summary y volver a pedir el turno.
      const movements = await tx.cashMovement.findMany({
        where: { sessionId: session.id },
        ...MOVEMENT_INCLUDE,
      });

      const arqueo = buildArqueo({
        openingAmount: session.openingAmount,
        openingTransferAmount: session.openingTransferAmount,
        movements,
        countedCashAmount,
        countedTransferAmount,
      });

      const closedAt = new Date();

      // La caja chica: lo que queda en el cajón después del retiro. Es el número que
      // abre el turno siguiente, y el que va a arrastrar una apertura manual.
      const pettyCashAmount = roundMoney(arqueo.countedCashAmount - retirado);

      const closed = await tx.cashRegisterSession.update({
        where: { id: session.id },
        data: {
          status: "CLOSED",
          closedById,
          closedAt,
          closingNote: note,
          countedCashAmount: arqueo.countedCashAmount,
          withdrawnCashAmount: retirado,
          pettyCashAmount,
          expectedCashAmount: arqueo.expectedCashAmount,
          cashDifference: arqueo.cashDifference,
          transferTotal: arqueo.transferTotal,
          expectedTransferAmount: arqueo.expectedTransferAmount,
          countedTransferAmount: arqueo.countedTransferAmount,
          transferDifference: arqueo.transferDifference,
        },
      });

      // La misma hora que el arqueo: el sello de la orden y el del turno tienen que
      // poder leerse juntos sin que uno diga 23:59:59 y el otro 00:00:00.
      const archivedOrders = await archiveTerminalOrders(tx, {
        tenantId,
        sessionId: session.id,
        actorId: closedById,
        at: closedAt,
      });

      // Adentro de la transacción: si el archivado falla no puede quedar el turno
      // cerrado sin su continuación (ni al revés, dos cajas abiertas).
      const nextSession = reopen
        ? await createSession(tx, {
            tenantId,
            // Con la caja chica y no con lo contado: lo retirado ya no está en el
            // cajón. Sin retiro los dos números son el mismo, que es como venía.
            openingAmount: pettyCashAmount,
            // Lo contado si alguien miró el banco; si no, el esperado: el saldo
            // continúa igual, lo que no hay es una diferencia firmada.
            openingTransferAmount:
              arqueo.countedTransferAmount ?? arqueo.expectedTransferAmount,
            openedById: closedById,
            now: closedAt,
            schedule,
            trigger: "MANUAL",
            note: "Continúa el arqueo anterior",
          })
        : null;

      return {
        ...closed,
        totals: arqueo,
        summary: summarizeMovements(movements),
        archivedOrders,
        nextSession,
      };
    });
  },

  /** Historial de turnos, más nuevos primero, con la cantidad de movimientos. */
  async getAll({ tenantId, from, to, limit = 20, offset = 0 }) {
    await assertEnabled(tenantId);

    const where = { tenantId, ...(dateRange(from, to) && { openedAt: dateRange(from, to) }) };

    const [sessions, total] = await Promise.all([
      prisma.cashRegisterSession.findMany({
        where,
        orderBy: { openedAt: "desc" },
        take: limit,
        skip: offset,
        include: { _count: { select: { movements: true } } },
      }),
      prisma.cashRegisterSession.count({ where }),
    ]);

    return { sessions, total, limit, offset };
  },

  /**
   * Un turno con sus movimientos y sus órdenes. Cerrado devuelve el arqueo tal como
   * se guardó.
   *
   * `orders` son las que ese turno archivó al cerrar, y es la razón por la que el
   * historial de órdenes se lee desde acá en vez de tener pantalla propia: "las
   * órdenes del martes" es "el turno del martes".
   *
   * En un turno ABIERTO viene vacío —todavía no se archivó nada— y en su lugar va
   * `ordersToClose`, que es la previsión de lo que se va a llevar el cierre.
   */
  async getById({ tenantId, id }) {
    await assertEnabled(tenantId);

    const session = await prisma.cashRegisterSession.findFirst({
      where: { id, tenantId },
      include: {
        movements: { ...MOVEMENT_INCLUDE, orderBy: { createdAt: "asc" } },
      },
    });

    if (!session) {
      throw createError("Caja no encontrada", "CASH_SESSION_NOT_FOUND", 404);
    }

    const [orders, ordersToClose] = await Promise.all([
      prisma.order.findMany({
        where: { tenantId, cashSessionId: session.id },
        select: SESSION_ORDER_SELECT,
        orderBy: { createdAt: "asc" },
      }),
      session.status === "OPEN"
        ? summarizeArchivable(prisma, { tenantId })
        : null,
    ]);

    return {
      ...session,
      orders,
      ordersToClose,
      summary: summarizeMovements(session.movements),
      // Un turno abierto no tiene arqueo guardado: se calcula en vivo. Uno cerrado
      // devuelve el snapshot, no un recálculo.
      totals:
        session.status === "OPEN"
          ? buildArqueo({
              openingAmount: session.openingAmount,
              openingTransferAmount: session.openingTransferAmount,
              movements: session.movements,
            })
          : {
              expectedCashAmount: session.expectedCashAmount,
              countedCashAmount: session.countedCashAmount,
              cashDifference: session.cashDifference,
              transferTotal: session.transferTotal,
              // Los turnos cerrados antes de que existiera el saldo de
              // transferencias no tienen esperado: ahí lo más cercano es su neto.
              expectedTransferAmount:
                session.expectedTransferAmount ?? session.transferTotal,
              countedTransferAmount: session.countedTransferAmount,
              transferDifference: session.transferDifference,
              // Derivado del snapshot, no guardado: el aviso tiene que seguir estando
              // cuando alguien abre el turno en el historial y se pregunta por qué el
              // esperado era negativo.
              expectedNegative: isExpectedNegative(session.expectedCashAmount),
            },
    };
  },

  /**
   * El turno como planilla de Excel (`.xlsx`): tres hojas —el arqueo, el detalle
   * de movimientos y en qué se fue la plata—. Es el reemplazo del "resumen
   * imprimible": un `.xlsx` se imprime igual y además se puede sumar aparte.
   *
   * Reusa `getById`, así que hereda el chequeo del flag y el scoping por tenant, y
   * los números salen de la misma fuente que la API.
   *
   * @returns {Promise<{buffer: Buffer, filename: string}>}
   */
  async exportSession({ tenantId, id }) {
    const session = await this.getById({ tenantId, id });

    const [config, userNames] = await Promise.all([
      prisma.tenantConfig.findUnique({
        where: { tenantId },
        select: { storeName: true, currency: true },
      }),
      resolveUserNames(session),
    ]);

    const buffer = await buildSessionXlsx({
      session,
      storeName: config?.storeName ?? null,
      currency: config?.currency ?? "ARS",
      userNames,
    });

    return { buffer, filename: sessionFileName(session) };
  },

  /**
   * La planilla del PERÍODO: todos los turnos del rango con el detalle completo, para
   * pasarle el mes al contador de una sola vez.
   *
   * Los turnos se toman por `openedAt` y **enteros** (mismo criterio que el
   * dashboard): el turno noche que cierra a las 2 AM entra completo en el mes en que
   * empezó, no se parte.
   */
  async exportPeriod({ tenantId, from, to }) {
    await assertEnabled(tenantId);

    const range = dateRange(from, to);

    const sessions = await prisma.cashRegisterSession.findMany({
      where: { tenantId, ...(range && { openedAt: range }) },
      orderBy: { openedAt: "asc" },
      include: {
        movements: { ...MOVEMENT_INCLUDE, orderBy: { createdAt: "asc" } },
      },
    });

    const [config, userNames] = await Promise.all([
      prisma.tenantConfig.findUnique({
        where: { tenantId },
        select: { storeName: true, currency: true },
      }),
      resolveUserNames(sessions),
    ]);

    const buffer = await buildPeriodXlsx({
      sessions,
      range: { from: from ?? null, to: to ?? null },
      storeName: config?.storeName ?? null,
      currency: config?.currency ?? "ARS",
      userNames,
    });

    return { buffer, filename: periodFileName({ from, to }) };
  },

  // ── Movimientos ──────────────────────────────────────────────────────────

  /**
   * Movimiento manual: lo que no viene de una orden. Sueldos, insumos, servicios,
   * retiros, aportes de cambio.
   *
   * Cae SIEMPRE en el turno abierto al momento de crearse: no hay parámetro de
   * sesión en ninguna escritura, así que no se puede backdatear un movimiento a un
   * turno ya arqueado.
   */
  async addMovement({
    tenantId,
    type,
    channel,
    amount,
    categoryId,
    payee = null,
    note = null,
    createdById = null,
  }) {
    await assertEnabled(tenantId);

    // Zod ya lo restringe en la ruta; acá también, porque el service se llama
    // desde tests y scripts: los ORDER_* los escribe únicamente el enganche con el
    // libro de cobros, si no la caja podría "cobrar" una orden que nadie cobró.
    if (!MANUAL_MOVEMENT_TYPES.includes(type)) {
      const error = createError(
        "Ese tipo de movimiento lo registra solo el sistema, a partir de los cobros de las órdenes",
        "CASH_MOVEMENT_TYPE_NOT_MANUAL",
        400
      );
      error.details = { pedido: type, manuales: MANUAL_MOVEMENT_TYPES };
      throw error;
    }

    return prisma.$transaction(async (tx) => {
      const session = await requireOpenSession(tenantId, tx);
      const category = await resolveCategory(tx, { tenantId, categoryId, type });

      return tx.cashMovement.create({
        data: {
          tenantId,
          sessionId: session.id,
          type,
          channel,
          amount: roundMoney(Number(amount)),
          categoryId: category.id,
          payee,
          note,
          createdById,
        },
        ...MOVEMENT_INCLUDE,
      });
    });
  },

  /**
   * Totales por etiqueta y por tipo en un rango de fechas, cruzando turnos: es la
   * respuesta a "cuánto pagué de sueldos en julio" y "cuánto se fue en insumos".
   *
   * Se hace con `groupBy` y no trayendo los movimientos porque esto crece con el
   * tiempo; el signo se aplica por grupo, que es la razón de agrupar también por
   * `type` (dos filas de la misma etiqueta pueden restar y sumar).
   */
  async getSummary({ tenantId, from, to }) {
    await assertEnabled(tenantId);

    const range = dateRange(from, to);
    const where = { tenantId, ...(range && { createdAt: range }) };

    const [porTipo, porEtiqueta, categorias] = await Promise.all([
      prisma.cashMovement.groupBy({
        by: ["type", "channel"],
        where,
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.cashMovement.groupBy({
        by: ["categoryId", "type"],
        where: { ...where, NOT: { categoryId: null } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.cashCategory.findMany({
        where: { tenantId },
        select: CATEGORY_FIELDS,
      }),
    ]);

    const byType = {};
    const byChannel = { CASH: 0, TRANSFER: 0 };

    for (const row of porTipo) {
      const signed = roundMoney(CASH_MOVEMENT_SIGN[row.type] * (row._sum.amount ?? 0));
      byType[row.type] = roundMoney((byType[row.type] ?? 0) + signed);
      byChannel[row.channel] = roundMoney((byChannel[row.channel] ?? 0) + signed);
    }

    const labels = new Map(categorias.map((c) => [c.id, c]));
    const byCategory = {};

    for (const row of porEtiqueta) {
      const category = labels.get(row.categoryId);
      const key = category?.key ?? String(row.categoryId);
      const signed = roundMoney(CASH_MOVEMENT_SIGN[row.type] * (row._sum.amount ?? 0));
      const bucket = byCategory[key] ?? {
        categoryId: row.categoryId,
        label: category?.label ?? null,
        total: 0,
        count: 0,
      };

      bucket.total = roundMoney(bucket.total + signed);
      bucket.count += row._count._all;
      byCategory[key] = bucket;
    }

    return { from: from ?? null, to: to ?? null, byType, byChannel, byCategory };
  },

  // ── Etiquetas ────────────────────────────────────────────────────────────

  async listCategories({ tenantId, includeInactive = false }) {
    await assertEnabled(tenantId);

    return prisma.cashCategory.findMany({
      where: { tenantId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: CATEGORY_FIELDS,
    });
  },

  /**
   * `key` es el slug estable de la etiqueta y no se puede cambiar después: es lo
   * que un reporte guardado o una integración usa para referirse a "insumos". El
   * `label` sí se edita.
   */
  async createCategory({ tenantId, key, label, applies = "EXPENSE", position = 0 }) {
    await assertEnabled(tenantId);

    // Las claves reservadas ya existen y son del sistema; que alguien cree otra
    // "venta" con otra dirección haría ambiguo el reporte.
    if (SYSTEM_CASH_CATEGORIES.some((category) => category.key === key)) {
      const error = createError(
        `"${key}" es una etiqueta reservada del sistema`,
        "CASH_CATEGORY_RESERVED",
        400
      );
      error.details = { reservadas: SYSTEM_CASH_CATEGORIES.map((c) => c.key) };
      throw error;
    }

    try {
      return await prisma.cashCategory.create({
        data: { tenantId, key, label, applies, position },
        select: CATEGORY_FIELDS,
      });
    } catch (error) {
      if (error.code === "P2002") {
        throw createError(
          "Ya existe una etiqueta con esa clave",
          "CASH_CATEGORY_DUPLICATE",
          409
        );
      }
      throw error;
    }
  },

  async updateCategory({ tenantId, id, label, applies, position, isActive }) {
    await assertEnabled(tenantId);

    const category = await prisma.cashCategory.findFirst({
      where: { id, tenantId },
      select: { id: true, key: true, isSystem: true },
    });

    if (!category) {
      throw createError("Etiqueta no encontrada", "CASH_CATEGORY_NOT_FOUND", 404);
    }

    // De una reservada solo se puede cambiar el NOMBRE. Desactivarla o darle vuelta
    // la dirección rompería el próximo cobro de una orden (o lo archivaría como
    // gasto); renombrarla es inofensivo y cada rubro le dice distinto.
    if (category.isSystem && (applies !== undefined || isActive !== undefined)) {
      const error = createError(
        "De una etiqueta del sistema solo se puede cambiar el nombre",
        "CASH_CATEGORY_RESERVED",
        400
      );
      error.details = { etiqueta: category.key, editable: ["label", "position"] };
      throw error;
    }

    return prisma.cashCategory.update({
      where: { id },
      data: {
        ...(label !== undefined && { label }),
        ...(applies !== undefined && { applies }),
        ...(position !== undefined && { position }),
        ...(isActive !== undefined && { isActive }),
      },
      select: CATEGORY_FIELDS,
    });
  },

  /**
   * Borra una etiqueta que nunca se usó. Si tiene movimientos, 409: la salida es
   * desactivarla (`isActive: false`), porque un movimiento de hace tres meses
   * tiene que seguir diciendo qué era. La FK es `Restrict`, así que además la base
   * lo impediría.
   */
  async deleteCategory({ tenantId, id }) {
    await assertEnabled(tenantId);

    const category = await prisma.cashCategory.findFirst({
      where: { id, tenantId },
      select: { id: true, key: true, isSystem: true },
    });

    if (!category) {
      throw createError("Etiqueta no encontrada", "CASH_CATEGORY_NOT_FOUND", 404);
    }

    if (category.isSystem) {
      const error = createError(
        "Las etiquetas del sistema no se borran",
        "CASH_CATEGORY_RESERVED",
        400
      );
      error.details = { etiqueta: category.key };
      throw error;
    }

    const usos = await prisma.cashMovement.count({ where: { categoryId: id } });

    if (usos > 0) {
      const error = createError(
        "La etiqueta tiene movimientos registrados: desactivala en vez de borrarla",
        "CASH_CATEGORY_IN_USE",
        409
      );
      error.details = { movimientos: usos };
      throw error;
    }

    await prisma.cashCategory.delete({ where: { id } });

    return { id };
  },

  /**
   * Siembra el catálogo de arranque si el tenant no tiene ninguna etiqueta. La usa
   * `prisma/set-cash-register.js` al habilitar la caja; idempotente.
   */
  async ensureDefaultCategories({ tenantId }) {
    // Las reservadas van siempre: no son parte del "kit de arranque" que el tenant
    // puede haber tocado, son un requisito del enganche con los cobros.
    await ensureSystemCategories(tenantId);

    const existentes = await prisma.cashCategory.count({
      where: { tenantId, isSystem: false },
    });

    if (existentes > 0) return { created: 0, existing: existentes };

    const { count } = await prisma.cashCategory.createMany({
      data: DEFAULT_CASH_CATEGORIES.map((c) => ({ ...c, tenantId })),
    });

    return { created: count, existing: 0 };
  },
};

/**
 * Anota en la caja los cobros que se acaban de escribir en el libro de una orden.
 * **Un movimiento por fila del libro**, y nada más: no hay fórmula de "pendiente
 * por método" que mantener sincronizada, porque el monto y la vía ya vienen
 * resueltos en la fila.
 *
 * Recibe el `tx` del caller y NO abre transacción propia: el cobro y su impacto en
 * el arqueo entran o no entran juntos. Los dos caminos que escriben en el libro lo
 * llaman —`applyPayments` (las tres confirmaciones + el registro directo) y la
 * liquidación de `updateOrderStatus` (el "entregar es cobrar")—, porque si colgara
 * solo del primero, el efectivo del mostrador nunca llegaría al arqueo.
 *
 * Se saltea `GATEWAY`: MercadoPago no pasa por el cajón. Si el tenant no tiene la
 * caja habilitada, no hace nada — y es lo que hace que prender este módulo no
 * cambie ningún comportamiento existente hasta que se prenda.
 *
 * @param {object} p
 * @param {Array}  p.payments filas de `OrderPayment` YA creadas (con `id`)
 * @returns {Promise<{movements: number, sessionId: number|null}>}
 */
export async function recordOrderPayments(
  tx,
  { tenantId, orderId, payments = [], actorId = null }
) {
  const delCajon = payments.filter((payment) => payment.channel !== "GATEWAY");

  if (!delCajon.length) return { movements: 0, sessionId: null };

  // Se lee de la base y no del cache de `TenantConfigModel.get` (TTL 600 s): de
  // este flag depende un guard, y una lectura vieja significaría saltearlo.
  const config = await tx.tenantConfig.findUnique({
    where: { tenantId },
    select: { cashRegisterEnabled: true },
  });

  if (!config?.cashRegisterEnabled) return { movements: 0, sessionId: null };

  // El punto operativo más importante del módulo: si el cobro pudiera registrarse
  // fuera de un turno, el arqueo del día quedaría siempre mal y nadie sabría por
  // qué. Como esto corre dentro de la transacción del caller, el 409 deja la orden
  // SIN el cobro sellado.
  const session = await requireOpenSession(tenantId, tx);
  // Etiquetas reservadas: así el movimiento de una venta queda etiquetado como
  // cualquier otro y el resumen por etiqueta cubre toda la plata.
  const reservadas = await ensureSystemCategories(tenantId, tx);

  const data = delCajon.map((payment) => {
    const type = ORDER_KIND_TO_TYPE[payment.kind];

    if (!type) {
      throw createError(
        `Cobro de tipo "${payment.kind}" sin movimiento de caja equivalente`,
        "CASH_MOVEMENT_KIND_UNMAPPED",
        500
      );
    }

    const orden = payment.orderId ?? orderId;

    return {
      tenantId,
      sessionId: session.id,
      type,
      channel: payment.channel,
      amount: roundMoney(Number(payment.amount)),
      categoryId: reservadas.get(ORDER_TYPE_TO_CATEGORY[type])?.id ?? null,
      orderId: orden,
      orderPaymentId: payment.id,
      note: `Orden #${orden}`,
      createdById: actorId ?? payment.confirmedById ?? null,
    };
  });

  // `skipDuplicates` + el UNIQUE de `orderPaymentId`: si por cualquier camino se
  // intentara anotar dos veces el mismo cobro, no se duplica en el arqueo.
  await tx.cashMovement.createMany({ data, skipDuplicates: true });

  return { movements: data.length, sessionId: session.id };
}

/**
 * Nombres de los usuarios que aparecen en un turno (quién abrió, quién cerró,
 * quién cargó cada movimiento). Se resuelven a mano porque `openedById` y compañía
 * son enteros sin FK —igual que `changedById` en el historial de órdenes—, y en un
 * reporte que va a un contador un "usuario #7" no dice nada.
 */
async function resolveUserNames(sessions) {
  const ids = new Set();

  for (const session of [].concat(sessions)) {
    for (const id of [session.openedById, session.closedById]) {
      if (id != null) ids.add(id);
    }
    for (const movement of session.movements ?? []) {
      if (movement.createdById != null) ids.add(movement.createdById);
    }
  }

  if (ids.size === 0) return new Map();

  const users = await prisma.user.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, username: true },
  });

  return new Map(users.map((user) => [user.id, user.username]));
}

/**
 * Etiqueta válida para este movimiento: que exista, que esté activa y que aplique
 * a la dirección del movimiento. Lo último es lo que evita que el reporte de fin
 * de mes nazca sucio con un ingreso archivado bajo "Sueldos".
 */
async function resolveCategory(tx, { tenantId, categoryId, type }) {
  const category = await tx.cashCategory.findFirst({
    where: { id: categoryId, tenantId },
    select: CATEGORY_FIELDS,
  });

  if (!category) {
    throw createError("Etiqueta no encontrada", "CASH_CATEGORY_NOT_FOUND", 404);
  }

  if (!category.isActive) {
    throw createError(
      "La etiqueta está desactivada",
      "CASH_CATEGORY_INACTIVE",
      409
    );
  }

  // Las reservadas significan exactamente "cobro de una orden": si se pudieran usar
  // a mano, la cifra de ventas dejaría de tener una orden detrás y el cruce con
  // Estadísticas (facturado vs cobrado) empezaría a mentir.
  if (category.isSystem) {
    const error = createError(
      "Esa etiqueta es del sistema: la usan los cobros de las órdenes, no se puede elegir a mano",
      "CASH_CATEGORY_RESERVED",
      400
    );
    error.details = { etiqueta: category.key };
    throw error;
  }

  if (category.applies !== "BOTH" && category.applies !== type) {
    const error = createError(
      "La etiqueta no aplica a ese tipo de movimiento",
      "CASH_CATEGORY_KIND_MISMATCH",
      400
    );
    error.details = { etiqueta: category.key, aplicaA: category.applies, movimiento: type };
    throw error;
  }

  return category;
}
