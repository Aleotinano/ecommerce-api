import crypto from "node:crypto";
import { DEFAULTS } from "../config.js";

export const GUEST_CART_COOKIE = "guest_cart_id";

const isProd = DEFAULTS.NODE_ENV === "production";

// storeCors() acepta cualquier origen con credentials:true (el storefront puede vivir
// en un dominio totalmente distinto al backend) — en prod eso exige SameSite=None +
// Secure. En dev, Lax alcanza (mismo "site" localhost, distinto puerto) y no requiere
// HTTPS local.
export const GUEST_CART_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? "none" : "lax",
  path: "/store",
  maxAge: 1000 * 60 * 60 * 24 * 30, // 30 días
};

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
    res.cookie(GUEST_CART_COOKIE, guestId, GUEST_CART_COOKIE_OPTIONS);
  }

  req.cartOwner = { userId: null, guestId };
  next();
}
