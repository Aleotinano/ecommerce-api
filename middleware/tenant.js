import { createError } from "../helpers/error.js";
import prisma from "../lib/prisma.js";
import { DEFAULTS } from "../config.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
const IGNORED_SUBDOMAINS = new Set(["www", "api", "app"]);

// El host de la API NUNCA es un slug de tenant. Descartarlo por nombre no alcanza:
// `IGNORED_SUBDOMAINS` es una lista de tres, y cualquier dominio de 3+ partes que
// no empiece con www/api/app cae en la trampa. El caso concreto que la destapó es
// DuckDNS: con la API en `micomercio.duckdns.org`, `micomercio` se leía como slug
// y —al tener el host prioridad sobre el header— TODO /store/* contestaba
// TENANT_NOT_FOUND. O sea el catálogo, el carrito, el checkout y el chat, mientras
// el panel admin seguía funcionando (su tenant sale del usuario autenticado): el
// síntoma más confuso posible.
//
// Se deriva de BASE_URL, que ya es obligatoria y ya apunta exactamente ahí, en vez
// de sumar otra env var que se pueda olvidar. El diseño de subdominio-por-tenant
// no se toca: `acme.midominio.com` sigue resolviendo a `acme` porque ese host no
// es el de la API.
const API_HOSTNAME = (() => {
  try {
    return new URL(DEFAULTS.BASE_URL).hostname.toLowerCase();
  } catch {
    return null;
  }
})();

function extractSlugFromHost(hostname) {
  if (!hostname) return null;

  const host = hostname.toLowerCase();
  if (LOCAL_HOSTS.has(host)) return null;
  if (API_HOSTNAME && host === API_HOSTNAME) return null;

  const parts = host.split(".");
  if (parts.length < 3) return null;

  const first = parts[0];
  if (IGNORED_SUBDOMAINS.has(first)) return null;

  return first;
}

function resolveSlug(req) {
  const fromHost = extractSlugFromHost(req.hostname);
  const fromHeader = req.get("x-tenant-slug");
  return (fromHost || fromHeader || "").trim().toLowerCase();
}

export function resolveTenantSlug(req, _res, next) {
  const slug = resolveSlug(req);

  if (!slug) {
    return next(
      createError(
        "Tenant no identificado (usar subdominio o header X-Tenant-Slug)",
        "TENANT_REQUIRED",
        400
      )
    );
  }

  req.tenantSlug = slug;
  next();
}

export async function resolveTenantFromSlug(req, _res, next) {
  const slug = resolveSlug(req);

  if (!slug) {
    return next(
      createError(
        "Tenant no identificado (usar subdominio o header X-Tenant-Slug)",
        "TENANT_REQUIRED",
        400
      )
    );
  }

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, slug: true, name: true, isActive: true },
    });

    if (!tenant) {
      return next(createError("Tienda no encontrada", "TENANT_NOT_FOUND", 404));
    }

    if (!tenant.isActive) {
      return next(
        createError("Tienda no disponible", "TENANT_INACTIVE", 403)
      );
    }

    req.tenantId = tenant.id;
    req.tenantSlug = tenant.slug;
    req.tenant = tenant;
    next();
  } catch (err) {
    next(err);
  }
}
