import { createError } from "../helpers/error.js";

/**
 * Perfiles de flujo de venta: el "kit de arranque" de la configuración de un
 * tenant nuevo.
 *
 * El motor de estados (`services/order-state.js`) ya sabe producir contra
 * entrega, contra transferencia adelantada o contra seña — la regla de dinero es
 * una sola y sale de estos parámetros. Lo que faltaba era poder decir, por
 * tenant, QUÉ métodos acepta: hasta ahora los enums de `schemas/order.schema.js`
 * valían para todos, así que una pastelería que solo cobra contra entrega igual
 * aceptaba una orden por transferencia y nadie la rechazaba.
 *
 * PURO a propósito: sin Prisma y sin DB, igual que `order-state.js`. Por eso lo
 * pueden consumir el registro, los seeds y el script de operación por igual, y se
 * testea sin base.
 *
 * Los valores se **materializan** en las columnas del tenant al crearlo: el
 * perfil es un punto de partida, no una indirección viva. Si mañana se edita un
 * perfil, los tenants ya creados no cambian — que es lo que se quiere cuando lo
 * que está en juego es cuándo se produce un pedido y cuánta plata se exige antes.
 */

/**
 * @typedef {object} TenantProfile
 * @property {string}   storeMode                 'SHOP' (se compra) | 'MENU' (se lee)
 * @property {string[]} paymentMethodsEnabled     valores de `OrderPaymentMethod`
 * @property {string[]} fulfillmentMethodsEnabled valores de `FulfillmentMethod`
 * @property {boolean}  depositEnabled
 * @property {number}   depositPercentage
 */

/** @type {Record<string, TenantProfile>} */
export const TENANT_PROFILES = {
  /**
   * Todo habilitado y sin seña. Es el DEFAULT, y coincide exactamente con los
   * `@default()` del schema Prisma: un tenant recién creado se comporta como
   * antes de que estos perfiles existieran, así que la migración no cambia a
   * nadie y un tenant sin configurar todavía no queda roto.
   *
   * Es también el perfil de mesa-dulce: usa los tres métodos de pago, las dos
   * formas de entrega y no cobra seña. No hace falta un perfil a medida.
   */
  estandar: {
    storeMode: "SHOP",
    paymentMethodsEnabled: ["CASH", "TRANSFER", "MIXED"],
    fulfillmentMethodsEnabled: ["DELIVERY", "PICKUP"],
    depositEnabled: false,
    depositPercentage: 50,
  },

  /**
   * Solo efectivo, solo envío: el repartidor cobra al entregar. No se exige nada
   * por adelantado (`moneyBlocker` no pide plata para CASH), y el cobro queda
   * registrado solo cuando la orden pasa a COMPLETED.
   */
  contraentrega: {
    storeMode: "SHOP",
    paymentMethodsEnabled: ["CASH"],
    fulfillmentMethodsEnabled: ["DELIVERY"],
    depositEnabled: false,
    depositPercentage: 50,
  },

  /**
   * Producción a pedido: hay que cobrar la seña antes de ponerse a producir. Con
   * la seña cubierta alcanza —el saldo se cobra al entregar—, que es el trato del
   * rubro.
   */
  "produccion-por-sena": {
    storeMode: "SHOP",
    paymentMethodsEnabled: ["CASH", "TRANSFER", "MIXED"],
    fulfillmentMethodsEnabled: ["DELIVERY", "PICKUP"],
    depositEnabled: true,
    depositPercentage: 50,
  },

  /**
   * El catálogo se LEE, no se compra: carta de restaurante o de cafetería. El
   * pedido se cierra por fuera del sistema (WhatsApp, mostrador), así que el
   * storefront no monta carrito y apaga `/checkout`.
   *
   * Los métodos de pago y entrega quedan poblados como en `estandar`, y no
   * vacíos: en este modo no nacen órdenes, así que las listas no gobiernan nada,
   * y dejarlas vacías obligaría a `OrderModel.create` a distinguir "sin métodos
   * habilitados" de "no vende" — dos motivos distintos para el mismo rechazo. El
   * campo que dice qué es este tenant es `storeMode`, uno solo.
   *
   * Si un cliente de carta después empieza a vender online, el cambio es pasarlo
   * a `estandar`: no hay nada más que deshacer.
   */
  carta: {
    storeMode: "MENU",
    paymentMethodsEnabled: ["CASH", "TRANSFER", "MIXED"],
    fulfillmentMethodsEnabled: ["DELIVERY", "PICKUP"],
    depositEnabled: false,
    depositPercentage: 50,
  },
};

/** Perfil que se aplica cuando nadie indica otro. */
export const DEFAULT_TENANT_PROFILE = "estandar";

/** Nombres válidos, para mensajes de error y para el script de operación. */
export const TENANT_PROFILE_NAMES = Object.keys(TENANT_PROFILES);

/**
 * Devuelve una COPIA de los valores del perfil, lista para spardecir en un
 * `tenantConfig.create`/`update`.
 *
 * Lanza si el nombre no existe en vez de caer al default: un typo en el script de
 * operación tiene que fallar fuerte, no crear un tenant con la config de otro
 * flujo de negocio y que nadie se entere hasta que un pedido no se pueda cobrar.
 *
 * La copia (y el `slice()` de los arrays) evita que un caller que mute lo que
 * recibe termine editando el perfil para todo el proceso.
 *
 * @param {string} [name=DEFAULT_TENANT_PROFILE]
 * @returns {TenantProfile}
 */
export function resolveProfile(name = DEFAULT_TENANT_PROFILE) {
  const profile = TENANT_PROFILES[name];

  if (!profile) {
    throw createError(
      `Perfil de tenant desconocido: "${name}"`,
      "TENANT_PROFILE_UNKNOWN",
      400,
      { perfil: name, validos: TENANT_PROFILE_NAMES }
    );
  }

  return {
    ...profile,
    paymentMethodsEnabled: profile.paymentMethodsEnabled.slice(),
    fulfillmentMethodsEnabled: profile.fulfillmentMethodsEnabled.slice(),
  };
}
