import { createError } from "../helpers/error.js";

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

export function resolveTenantSlug(req, _res, next) {
  const fromHost = extractSlugFromHost(req.hostname);
  const fromHeader = req.get("x-tenant-slug");

  const slug = (fromHost || fromHeader || "").trim().toLowerCase();

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
