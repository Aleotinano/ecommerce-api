import cors from "cors";
import { DEFAULTS } from "../config.js";
import { createError } from "../helpers/error.js";
import { isLocalhostOrigin } from "../helpers/origin.js";

const ACCEPTED_ORIGINS = DEFAULTS.ORIGINS;
const isProd = DEFAULTS.NODE_ENV === "production";

// Cuánto puede cachear el browser el resultado del preflight. Sin esto, CADA
// request no-simple se paga doble (OPTIONS + la real). El valor es un techo que
// los browsers recortan por su cuenta (Chrome 2 h, Firefox 24 h), así que pedir
// un día no es optimista: es dejar que cada uno use su máximo.
const PREFLIGHT_MAX_AGE = 86400;

// En desarrollo, cualquier puerto de localhost/127.0.0.1 es válido — y también
// cualquier SUBDOMINIO de localhost, que es como se entra a un tenant en dev:
// `http://mesa-dulce.localhost:3000`. Sin eso, el storefront multi-tenant local
// caía a la lista de ORIGINS —que enumera puertos de localhost pelado— y todo
// /store/* moría en el preflight con 403. Ver helpers/origin.js.
//
// Esto NO toca producción: la puerta sigue siendo `!isProd` unas líneas más
// abajo, así que fuera de dev un `*.localhost` se evalúa contra ORIGINS como
// cualquier otro origen.

// Una request SIN header `Origin` no es una request cross-origin: es un cliente
// que no es un browser (curl, el healthcheck del contenedor, un webhook
// server-to-server de MercadoPago o Meta) o una navegación same-origin. CORS no
// tiene nada que autorizar ahí, así que se deja pasar SIN emitir headers de CORS
// (`callback(null, false)` = seguí, pero no autorices ningún origen).
//
// Rechazarla —que es lo que hacía antes en prod— no protegía nada y rompía tres
// cosas a la vez: el HEALTHCHECK del Dockerfile dejaba el contenedor unhealthy
// para siempre, y los dos webhooks entrantes contestaban 500 (Meta desactiva un
// webhook que falla). Lo que frena CSRF acá es `sameSite: "strict"` en la cookie
// de sesión, no este filtro. Ver docs/DEPLOY.md.
const NO_ORIGIN = false;

export const middleWare = ({ acceptedOrigins = ACCEPTED_ORIGINS } = {}) => {
  return cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, isProd ? NO_ORIGIN : true);

      if (!isProd && isLocalhostOrigin(origin)) {
        return callback(null, true);
      }

      if (acceptedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // 403 y código propio, no un Error pelado: sin `statusCode` el errorHandler
      // caía a 500, y en producción un 500 se enmascara como "Error interno del
      // servidor" (errorHandler.js). O sea que el front recibía un INTERNAL_ERROR
      // opaco para lo que en realidad es un origen mal configurado — el error más
      // fácil de arreglar si te lo dicen, y el más caro de diagnosticar si no.
      return callback(
        createError(
          "El origen no está permitido",
          "CORS_ORIGIN_NOT_ALLOWED",
          403
        )
      );
    },
    credentials: true,
    maxAge: PREFLIGHT_MAX_AGE,
  });
};

export const storeCors = () => {
  return cors({
    origin: (origin, callback) => {
      // Mismo criterio que arriba: sin `Origin` no hay nada que autorizar.
      if (!origin) return callback(null, isProd ? NO_ORIGIN : true);
      callback(null, true);
    },
    credentials: true,
    exposedHeaders: ["Authorization"],
    maxAge: PREFLIGHT_MAX_AGE,
  });
};
