/**
 * Headers de cache para el storefront (`/store/*`).
 *
 * Dos problemas distintos que se resuelven acá:
 *
 * 1. **Frescura.** Express marca las respuestas JSON con un ETag débil pero no manda
 *    ningún `Cache-Control`. Sin directiva explícita, cada intermediario (browser,
 *    proxy, CDN) aplica su propia heurística: el catálogo del cliente puede quedar
 *    servido desde disco sin siquiera revalidar. El cache real de este backend es
 *    Redis (ver `lib/cache.js`), invalidado en cada escritura; el HTTP no debe
 *    agregar una segunda capa que el write no puede invalidar.
 *
 * 2. **Aislamiento por tenant.** El tenant viaja en el header `X-Tenant-Slug`
 *    (ver `middleware/tenant.js`), no en la URL. Un cache compartido que indexe solo
 *    por URL le serviría el catálogo del tenant A al tenant B. `Vary` lo declara
 *    explícitamente, y queda como red de seguridad aunque `no-store` ya lo cubra.
 *    `Authorization` va por lo mismo: `optionalStoreAuth` cambia la respuesta según
 *    haya sesión de cliente o no.
 */
export function storeCacheHeaders(req, res, next) {
  res.set("Cache-Control", "no-store");
  // `res.vary` appendea (no pisa el `Vary: Origin` que ya puso CORS).
  res.vary("X-Tenant-Slug");
  res.vary("Authorization");
  next();
}
