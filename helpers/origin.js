// Orígenes de desarrollo local. Vive acá y no dentro de middleware/cors.js porque
// lo consultan dos lugares que TIENEN que coincidir: el bypass de CORS y los
// atributos de la cookie del carrito de invitado (middleware/guestCart.js). Si
// uno acepta un origen que el otro considera ajeno, el catálogo carga pero el
// carrito se vacía solo, que es el peor de los dos síntomas: parece intermitente.
//
// El subdominio importa porque es la forma de entrar a un tenant en desarrollo:
// el storefront resuelve el slug desde el host, así que `mesa-dulce.localhost:3000`
// abre esa tienda sin tocar ninguna env. Se admite UN nivel a propósito:
// `evil.com.localhost` no entra, y con `?` en vez de `*` la superficie es la
// mínima que el storefront necesita.
//
// `127.0.0.1` va aparte: es una IP, no un nombre, y no lleva subdominios.
const LOCALHOST_ORIGIN = /^https?:\/\/(?:([a-z0-9-]+)\.)?localhost(?::\d+)?$/i;
const LOOPBACK_ORIGIN = /^https?:\/\/127\.0\.0\.1(?::\d+)?$/;

export const isLocalhostOrigin = (origin) =>
  LOCALHOST_ORIGIN.test(origin) || LOOPBACK_ORIGIN.test(origin);

// `http://localhost:3000` -> `localhost:4000` es el MISMO site (el puerto no
// cuenta para SameSite), así que ese caso no necesita relajar nada. Sólo el
// subdominio cruza de site.
export const isLocalhostSubdomainOrigin = (origin) =>
  Boolean(LOCALHOST_ORIGIN.exec(origin)?.[1]);
