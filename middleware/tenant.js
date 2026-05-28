import { createError } from "../helpers/error.js";
import prisma from "../lib/prisma.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
const IGNORED_SUBDOMAINS = new Set(["www", "api", "app"]);

function extractSlugFromHost(hostname) {
  if (!hostname) return null;
  if (LOCAL_HOSTS.has(hostname)) return null;

  const parts = hostname.split(".");
  if (parts.length < 3) return null;

  const first = parts[0].toLowerCase();
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
