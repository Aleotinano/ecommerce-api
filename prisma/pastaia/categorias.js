// Categorías de Pastaia, tomadas de ./catalogo.json (ver ./build-menu.js).
// Idempotente: correrlo de nuevo solo actualiza lo que cambió (orden, padre,
// descripción, ícono), no duplica categorías.
//   node prisma/pastaia/categorias.js
//
// Las 4 son raíces HOJA (Sorrentinos, Ravioles, Raviolones, Salsas) y son los tiles
// del grid de la landing: si el diseño cambia la cantidad de tiles, el árbol se ajusta
// acá ANTES de cargar productos. `imageUrl` queda en null — las fotos se cargan desde
// el panel y este seed no las pisa (no entran en `needsUpdate`).
//
// `position` solo se puede escribir desde acá: no está en schemas/category.schema.js,
// así que el PATCH del panel lo descarta. Reordenar la carta = editar menu.json,
// re-buildear y volver a correr este script.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import prisma from "../../lib/prisma.js";
import { CategoryModel } from "../../services/categories.js";
import { closeRedis } from "../../lib/redis.js";

const TENANT_SLUG = "pastaia";

const HERE = dirname(fileURLToPath(import.meta.url));

export function loadCatalogo() {
  return JSON.parse(readFileSync(join(HERE, "catalogo.json"), "utf8"));
}

export async function requireTenant() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) {
    throw new Error(
      `Tenant "${TENANT_SLUG}" no encontrado. Creálo antes con:\n` +
        `  pnpm tenant:create --name "Pastaia" --email <email> --profile estandar`
    );
  }
  return tenant;
}

async function ensureCategory({ tenantId, spec, parentId }) {
  const existing = await prisma.categories.findFirst({
    where: { tenantId, name: spec.name },
  });

  if (!existing) {
    const created = await CategoryModel.create({
      tenantId,
      name: spec.name,
      description: spec.description,
      icon: spec.icon,
      position: spec.position,
      parentId,
    });
    console.log(`  -> categoría "${spec.name}" creada (id ${created.id}, position ${spec.position})`);
    return created;
  }

  const needsUpdate =
    existing.position !== spec.position ||
    existing.parentId !== (parentId ?? null) ||
    existing.description !== spec.description ||
    existing.icon !== spec.icon;

  if (!needsUpdate) return existing;

  const updated = await CategoryModel.edit({
    tenantId,
    id: existing.id,
    description: spec.description,
    icon: spec.icon,
    position: spec.position,
    parentId: parentId ?? null,
  });
  console.log(`  -> categoría "${spec.name}" (id ${existing.id}) actualizada`);
  return updated;
}

export async function seedPastaiaCategorias() {
  const tenant = await requireTenant();
  const { categorias } = loadCatalogo();

  console.log("== Categorías de pastaia ==");
  const idByName = new Map();

  // Padres primero: la hija necesita el id del padre para su `parentId`. Hoy no hay
  // ninguna, pero el catálogo declara `parent` y esto lo soporta sin tocar nada.
  const roots = categorias.filter((c) => !c.parent);
  const children = categorias.filter((c) => c.parent);

  for (const spec of [...roots, ...children]) {
    const parentId = spec.parent ? idByName.get(spec.parent) : null;
    if (spec.parent && !parentId) {
      throw new Error(
        `La categoría "${spec.name}" declara el padre "${spec.parent}", que no existe en catalogo.json.`
      );
    }
    const category = await ensureCategory({ tenantId: tenant.id, spec, parentId });
    idByName.set(spec.name, category.id);
  }

  console.log(`  ${roots.length} raíces, ${children.length} subcategorías`);
  return idByName;
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  seedPastaiaCategorias()
    .then(() => console.log("Listo: categorías de pastaia sincronizadas."))
    .catch((err) => {
      console.error(err.message ?? err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeRedis();
      await prisma.$disconnect();
    });
}
