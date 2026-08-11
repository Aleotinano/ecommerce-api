import { MercadoPagoConfig, Preference, Payment } from "mercadopago";
import { DEFAULTS } from "../config.js";
import { createError } from "../helpers/error.js";

// El cliente se arma LAZY, no al importar el módulo. Antes esto era un
// `throw new Error("ACCESS_TOKEN no configurado")` en el cuerpo del módulo, y
// como la cadena app.js -> routes/mercadopago.js -> controllers -> services
// llega hasta acá al arrancar, un deploy sin credenciales de MercadoPago no
// levantaba: el proceso moría importando. Eso obligaba a inventar un token falso
// en cualquier tenant que cobre solo en efectivo o por transferencia — que son
// todos los de hoy.
//
// Mismo criterio que lib/cloudinary.js (`CLOUDINARY_NOT_CONFIGURED`) y que el
// módulo de WhatsApp: sin credenciales el módulo queda inactivo y la app arranca
// igual; el que falla es el request que de verdad necesitaba el gateway, con un
// error legible en vez de un 500.
let client = null;
let cached = null;

export const isMercadopagoConfigured = () => Boolean(DEFAULTS.ACCESS_TOKEN);

const getClient = () => {
  if (!isMercadopagoConfigured()) {
    throw createError(
      "MercadoPago no está configurado en este entorno",
      "MERCADOPAGO_NOT_CONFIGURED",
      503
    );
  }

  if (!client) {
    client = new MercadoPagoConfig({
      accessToken: DEFAULTS.ACCESS_TOKEN,
      options: { timeout: 5000 },
    });
    cached = { payment: new Payment(client), preference: new Preference(client) };
  }

  return cached;
};

export const getPayment = () => getClient().payment;
export const getPreference = () => getClient().preference;
