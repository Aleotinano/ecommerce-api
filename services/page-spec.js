import prisma from "../lib/prisma.js";
import { createError } from "../helpers/error.js";
import { wrap, del, tenantNs } from "../lib/cache.js";

/**
 * Persistencia del PageSpec del Page Builder por tenant.
 *
 * Modelo draft + published (decisión D2): el storefront sirve `publishedSpec`; el admin
 * (o la IA, fase posterior) edita `draftSpec`. Publicar es una acción humana explícita
 * que promueve el draft a published (mismo doble-checkpoint que el flujo de seña).
 *
 * Frontera (decisión D3, on-write): el `draftSpec` se normaliza en el admin con
 * `@repo/shared/page-builder/normalizeSpec` ANTES de guardarse, así lo que se publica ya
 * va limpio. El storefront igual re-normaliza al render (server-side) como última línea.
 *
 * Scoping por `tenantId` en todas las queries; el `tenantId` lo inyecta el middleware,
 * nunca llega del cliente (ver docs/servicios → Multi-tenancy).
 */

const PUBLISHED_TTL = 600;

function publishedKey(tenantId) {
  return `${tenantNs(tenantId)}:page-published`;
}

async function invalidatePublishedCache(tenantId) {
  await del(publishedKey(tenantId));
}

export const PageSpecModel = {
  /** Spec publicado que sirve el storefront. `null` si el tenant no publicó nada. */
  async getPublished({ tenantId }) {
    const key = publishedKey(tenantId);
    return wrap(key, PUBLISHED_TTL, async () => {
      const row = await prisma.tenantPageSpec.findUnique({
        where: { tenantId },
        select: { publishedSpec: true, version: true, publishedAt: true },
      });
      if (!row || !row.publishedSpec) return null;
      return {
        spec: row.publishedSpec,
        version: row.version,
        publishedAt: row.publishedAt,
      };
    });
  },

  /** Borrador que edita el admin. `null` si todavía no hay. Sin cache (debe reflejar saves al toque). */
  async getDraft({ tenantId }) {
    const row = await prisma.tenantPageSpec.findUnique({
      where: { tenantId },
      select: { draftSpec: true, version: true, updatedAt: true },
    });
    if (!row) return null;
    return { spec: row.draftSpec, version: row.version, updatedAt: row.updatedAt };
  },

  /** Guarda el borrador (upsert). No toca lo publicado. */
  async saveDraft({ tenantId, spec }) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) {
      throw createError("El tenant no existe", "TENANT_NOT_FOUND", 404);
    }

    const row = await prisma.tenantPageSpec.upsert({
      where: { tenantId },
      update: { draftSpec: spec },
      create: { tenantId, draftSpec: spec },
      select: { draftSpec: true, version: true, updatedAt: true },
    });
    return { spec: row.draftSpec, version: row.version, updatedAt: row.updatedAt };
  },

  /**
   * Promueve el borrador a publicado: `publishedSpec = draftSpec`, sube `version` y sella
   * `publishedAt`. Recién acá el cambio llega al cliente final.
   */
  async publish({ tenantId }) {
    const row = await prisma.tenantPageSpec.findUnique({
      where: { tenantId },
      select: { draftSpec: true, version: true },
    });
    if (!row || !row.draftSpec) {
      throw createError(
        "No hay borrador para publicar",
        "NO_DRAFT_TO_PUBLISH",
        409
      );
    }

    const updated = await prisma.tenantPageSpec.update({
      where: { tenantId },
      data: {
        publishedSpec: row.draftSpec,
        version: { increment: 1 },
        publishedAt: new Date(),
      },
      select: { publishedSpec: true, version: true, publishedAt: true },
    });

    await invalidatePublishedCache(tenantId);
    return {
      spec: updated.publishedSpec,
      version: updated.version,
      publishedAt: updated.publishedAt,
    };
  },
};
