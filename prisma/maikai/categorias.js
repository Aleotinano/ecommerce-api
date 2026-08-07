// Categorías del menú de Maikai, tomadas de ./menu.json (ver ./build-menu.js).
// Idempotente: correrlo de nuevo solo actualiza lo que cambió (orden, padre,
// descripción, ícono), no duplica categorías.
//   node prisma/maikai/categorias.js
//
// Las 8 RAÍCES son los tiles del grid de la home. `imageUrl` queda en null: las
// fotos de esos tiles todavía no están, y se cargan aparte (desde el panel o con
// un script propio) sin volver a tocar este seed.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import prisma from "../../lib/prisma.js";
import { CategoryModel } from "../../services/categories.js";
import { closeRedis } from "../../lib/redis.js";

const TENANT_SLUG = "maikai";

const HERE = dirname(fileURLToPath(import.meta.url));

export function loadMenu() {
  return JSON.parse(readFileSync(join(HERE, "menu.json"), "utf8"));
}

export async function requireTenant() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) {
    throw new Error(
      `Tenant "${TENANT_SLUG}" no encontrado. Creálo antes con:\n` +
        `  pnpm tenant:create --name "Maikai" --email <email> --profile carta`
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
    const rama = spec.parent ? `${spec.parent} > ` : "";
    console.log(`  -> categoría "${rama}${spec.name}" creada (id ${created.id}, position ${spec.position})`);
    return created;
  }

  const needsUpdate =
    existing.position !== spec.position ||
    existing.parentId !== (parentId ?? null) ||
    existing.description !== spec.description ||
    existing.icon !== spec.icon;

  if (!needsUpdate) {
    console.log(`  -> categoría "${spec.name}" ya está al día (id ${existing.id}), se omite`);
    return existing;
  }

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

export async function seedMaikaiCategorias() {
  const tenant = await requireTenant();
  const { categories } = loadMenu();

  console.log("== Categorías de maikai ==");
  const idByName = new Map();

  // Padres primero: la hija necesita el id del padre para su `parentId`.
  const roots = categories.filter((c) => !c.parent);
  const children = categories.filter((c) => c.parent);

  for (const spec of [...roots, ...children]) {
    const parentId = spec.parent ? idByName.get(spec.parent) : null;
    if (spec.parent && !parentId) {
      throw new Error(`La categoría "${spec.name}" declara el padre "${spec.parent}", que no existe en menu.json.`);
    }
    const category = await ensureCategory({ tenantId: tenant.id, spec, parentId });
    idByName.set(spec.name, category.id);
  }

  console.log(`  ${roots.length} raíces, ${children.length} subcategorías`);
  return idByName;
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  seedMaikaiCategorias()
    .then(() => console.log("Listo: categorías de maikai sincronizadas."))
    .catch((err) => {
      console.error(err.message ?? err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeRedis();
      await prisma.$disconnect();
    });
}
