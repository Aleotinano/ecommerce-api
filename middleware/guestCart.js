import crypto from "node:crypto";
import { DEFAULTS } from "../config.js";
import { isLocalhostSubdomainOrigin } from "../helpers/origin.js";

export const GUEST_CART_COOKIE = "guest_cart_id";

const isProd = DEFAULTS.NODE_ENV === "production";
const GUEST_CART_MAX_AGE = 1000 * 60 * 60 * 24 * 30; // 30 días

/**
 * Atributos de identidad de la cookie, SIN `maxAge`: son los que hay que repetir
 * tal cual para borrarla (`res.clearCookie`), y meterle un `maxAge` ahí la
 * RENUEVA en vez de borrarla — Express prioriza `maxAge` sobre el `expires` que
 * `clearCookie` inyecta.
 *
 * Se derivan del `Origin` de cada request en vez de fijarse al cargar el módulo,
 * porque en desarrollo depende de por dónde entró el visitante:
 *
 *   localhost:3000            -> localhost:4000   mismo "site" (el puerto no cuenta)
 *   mesa-dulce.localhost:3000 -> localhost:4000   sites DISTINTOS
 *
 * El segundo es la forma de abrir un tenant en dev, y ahí `Lax` no manda la
 * cookie en el fetch del carrito: el guestId se pierde en cada request y el
 * carrito de invitado queda vacío para siempre. `None` lo arregla y exige
 * `Secure`, que Chrome y Firefox aceptan sobre http:// cuando el host es
 * `localhost` o termina en `.localhost` — no hace falta HTTPS local.
 *
 * En producción es siempre `None` + `Secure`: `storeCors()` acepta cualquier
 * origen con `credentials: true` porque el storefront puede vivir en un dominio
 * totalmente distinto al backend.
 */
export function guestCartCookieAttrs(req) {
  const crossSite = isProd || isLocalhostSubdomainOrigin(req.get("origin") || "");

  return {
    httpOnly: true,
    secure: crossSite,
    sameSite: crossSite ? "none" : "lax",
    path: "/store",
  };
}

export function guestCartCookieOptions(req) {
  return { ...guestCartCookieAttrs(req), maxAge: GUEST_CART_MAX_AGE };
}

/**
 * Corre después de `optionalStoreAuth`. Si hay usuario logueado, el dueño del
 * carrito es el user (no se toca la cookie de guest). Si no, resuelve/emite un
 * guestId persistente vía cookie httpOnly y lo expone en `req.cartOwner`, consumido
 * por cartController/CartModel en vez de `req.user.id`.
 */
export function resolveCartOwner(req, res, next) {
  if (req.user?.id != null) {
    req.cartOwner = { userId: req.user.id, guestId: null };
    return next();
  }

  let guestId = req.cookies?.[GUEST_CART_COOKIE];
  if (!guestId) {
    guestId = crypto.randomUUID();
    res.cookie(GUEST_CART_COOKIE, guestId, guestCartCookieOptions(req));
  }

  req.cartOwner = { userId: null, guestId };
  next();
}
