// Categorías de agencia-video, tomadas de ./servicios.json.
// Idempotente: correrlo de nuevo solo actualiza lo que cambió (orden, descripción,
// ícono), no duplica categorías.
//   node prisma/agencia-video/categorias.js
//
// Las 5 son raíces HOJA y son las líneas de servicio: los chips que filtran la
// sección "Servicios" de la landing (plantilla `storefronts/servicios/` del
// storefront). `imageUrl` queda en null — esta plantilla no dibuja tiles con foto,
// y si algún día lo hace se cargan desde el panel (este seed no las pisa).
//
// `position` solo se puede escribir desde acá: no está en schemas/category.schema.js,
// así que el PATCH del panel lo descarta. Reordenar = editar servicios.json y volver
// a correr este script.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import prisma from "../../lib/prisma.js";
import { CategoryModel } from "../../services/categories.js";
import { closeRedis } from "../../lib/redis.js";

export const TENANT_SLUG = "agencia-video";

const HERE = dirname(fileURLToPath(import.meta.url));

// Topes de schemas/product.schema.js: se chequean acá para que el catálogo no se
// cargue con textos que después el admin no pueda guardar.
const DESCRIPCION_MAX = 600;
const SKU_MAX = 60;

/**
 * Lee y valida servicios.json. Acumula TODOS los problemas y tira una sola vez, en
 * vez de cortar en el primero: el archivo se edita a mano y arreglarlo de a un error
 * por corrida es lo que hace que la gente deje de correr el seed.
 */
export function loadCatalogo() {
  const raw = JSON.parse(readFileSync(join(HERE, "servicios.json"), "utf8"));
  const problemas = [];

  const categorias = new Set(raw.categorias.map((c) => c.name));
  const skus = new Set();

  for (const servicio of raw.servicios) {
    if (!categorias.has(servicio.category)) {
      problemas.push(`"${servicio.name}": la categoría "${servicio.category}" no está declarada`);
    }
    if ((servicio.description ?? "").length > DESCRIPCION_MAX) {
      problemas.push(`"${servicio.name}": la descripción pasa los ${DESCRIPCION_MAX} caracteres`);
    }
    if (!servicio.planes?.length) {
      problemas.push(`"${servicio.name}": no tiene ningún plan (todo PRODUCTO necesita al menos una variante)`);
      continue;
    }
    for (const plan of servicio.planes) {
      if (!plan.sku || plan.sku.length > SKU_MAX) {
        problemas.push(`"${servicio.name}" / "${plan.plan}": SKU vacío o de más de ${SKU_MAX} caracteres`);
      } else if (skus.has(plan.sku)) {
        problemas.push(`SKU repetido: ${plan.sku}`);
      }
      skus.add(plan.sku);
      // Un precio en null o en 0 en una lista que se muestra al público no es un
      // "a confirmar": es "gratis". Mejor que el seed no arranque.
      if (!Number.isInteger(plan.price) || plan.price <= 0) {
        problemas.push(`"${servicio.name}" / "${plan.plan}": precio inválido (${plan.price})`);
      }
    }
  }

  if (problemas.length) {
    throw new Error(`servicios.json tiene ${problemas.length} problemas:\n  - ${problemas.join("\n  - ")}`);
  }

  return raw;
}

/** Avisa, en cada corrida, si los precios todavía son la propuesta y no la lista real. */
export function avisarSiPreciosDeReferencia(catalogo) {
  if (catalogo.preciosConfirmados) return;
  console.warn(
    "  ⚠️  servicios.json tiene `preciosConfirmados: false`: los precios cargados son de REFERENCIA.\n" +
      "      Revisarlos con el equipo y pasar el flag a true (ver docs/servicios/Tenants/agencia-video.md)."
  );
}

export async function requireTenant() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) {
    throw new Error(
      `Tenant "${TENANT_SLUG}" no encontrado. Creálo antes con:\n` +
        `  pnpm tenant:create --name "Agencia Video" --email <email> --profile carta\n` +
        `El slug sale del --name: con otro nombre, el slug (y esta constante) cambian.`
    );
  }
  return tenant;
}

async function ensureCategory({ tenantId, spec }) {
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
      parentId: null,
    });
    console.log(`  -> categoría "${spec.name}" creada (id ${created.id}, position ${spec.position})`);
    return created;
  }

  const needsUpdate =
    existing.position !== spec.position ||
    existing.parentId !== null ||
    existing.description !== spec.description ||
    existing.icon !== spec.icon;

  if (!needsUpdate) return existing;

  const updated = await CategoryModel.edit({
    tenantId,
    id: existing.id,
    description: spec.description,
    icon: spec.icon,
    position: spec.position,
    parentId: null,
  });
  console.log(`  -> categoría "${spec.name}" (id ${existing.id}) actualizada`);
  return updated;
}

export async function seedAgenciaVideoCategorias() {
  const tenant = await requireTenant();
  const { categorias } = loadCatalogo();

  console.log("== Categorías de agencia-video ==");

  // Un solo nivel a propósito: los chips de la sección de servicios son una fila, no
  // un árbol. Si algún día hace falta una hija, el patrón está en pastaia/categorias.js.
  for (const spec of categorias) {
    await ensureCategory({ tenantId: tenant.id, spec });
  }

  console.log(`  ${categorias.length} líneas de servicio`);
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  seedAgenciaVideoCategorias()
    .then(() => console.log("Listo: categorías de agencia-video sincronizadas."))
    .catch((err) => {
      console.error(err.message ?? err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeRedis();
      await prisma.$disconnect();
    });
}
