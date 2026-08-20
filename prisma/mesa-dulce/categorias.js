// Categorías del catálogo real de mesa-dulce, con su imagen (Cloudinary) y
// orden de exhibición (`position`). Idempotente: correrlo de nuevo solo
// actualiza lo que cambió (imagen/orden), no duplica categorías.
//   node prisma/mesa-dulce/categorias.js
import "dotenv/config";
import { pathToFileURL } from "node:url";

import prisma from "../../lib/prisma.js";
import { CategoryModel } from "../../services/categories.js";
import { closeRedis } from "../../lib/redis.js";
import { cld } from "../lib/seed-helpers.js";

const TENANT_SLUG = "mesa-dulce";

// Imágenes de categoría subidas por el usuario (carpeta Cloudinary del tenant).
const CATEGORY_IMG = {
  cookiesClasicas: { id: "e-commerce-express/categories/1784521663953-262711056_ljtgza", v: 1784521651, ext: "png" },
  brownies: { id: "e-commerce-express/categories/1784521637015-155028250_esebkn", v: 1784521623, ext: "png" },
  cookiesRellenas: { id: "e-commerce-express/categories/1784521641616-3567118_jsoabu", v: 1784521627, ext: "png" },
  combos: { id: "e-commerce-express/categories/1784521653575-707176973_vqjcbi", v: 1784521640, ext: "png" },
  comboMundialista: { id: "e-commerce-express/categories/1784521625265-363871111_knn0hh", v: 1784521612, ext: "png" },
};

function categoryImage(key) {
  const asset = CATEGORY_IMG[key];
  return { imageUrl: cld(asset), imgPublicId: asset.id };
}

// `position` define el orden de exhibición en la tienda.
const CATEGORIES = [
  { name: "Cookies Clásicas", icon: "cookie", description: "Cookies clásicas de todos los días", position: 0, image: "cookiesClasicas" },
  { name: "Brownies", icon: "cookie", description: "Brownies de autor", position: 1, image: "brownies" },
  { name: "Cookies Rellenas", icon: "cookie", description: "Cookies rellenas gourmet", position: 2, image: "cookiesRellenas" },
  { name: "Combos", icon: "gift", description: "Combos armados de Mesa Dulce", position: 3, image: "combos" },
  // Ya no se vende (lo quitaron del menú), se deja de forma decorativa a
  // pedido del cliente.
  { name: "Combo Mundialista", icon: "gift", description: "Combo temático", position: 4, image: "comboMundialista" },
];

async function ensureCategory({ tenantId, spec }) {
  const { imageUrl, imgPublicId } = categoryImage(spec.image);
  const existing = await prisma.categories.findFirst({ where: { tenantId, name: spec.name } });

  if (!existing) {
    const created = await CategoryModel.create({
      tenantId,
      name: spec.name,
      description: spec.description,
      icon: spec.icon,
      position: spec.position,
      imageUrl,
      imgPublicId,
    });
    console.log(`  -> categoría "${spec.name}" creada (id ${created.id}, position ${spec.position})`);
    return created;
  }

  const needsUpdate =
    existing.position !== spec.position ||
    existing.imageUrl !== imageUrl ||
    existing.imgPublicId !== imgPublicId;

  if (!needsUpdate) {
    console.log(`  -> categoría "${spec.name}" ya está al día (id ${existing.id}), se omite`);
    return existing;
  }

  const updated = await CategoryModel.edit({
    tenantId,
    id: existing.id,
    position: spec.position,
    imageUrl,
    imgPublicId,
  });
  console.log(`  -> categoría "${spec.name}" (id ${existing.id}) actualizada (position/imagen)`);
  return updated;
}

// El tenant tiene que existir antes que cualquiera de estos scripts. En dev lo crea
// `pnpm seed`, pero ese camino NO existe en producción: arranca con un TRUNCATE de toda
// la base. De ahí que el mensaje mande a `tenant:create`, que es el único alta que sirve
// en los dos lados. Lo importan también ./productos.js y ./config.js.
export async function requireTenant() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) {
    throw new Error(
      `Tenant "${TENANT_SLUG}" no encontrado. Creálo antes con:\n` +
        `  pnpm tenant:create --name "Mesa Dulce" --email <email> --profile estandar`
    );
  }
  return tenant;
}

export async function seedMesaDulceCategorias() {
  const tenant = await requireTenant();

  console.log("== Categorías de mesa-dulce ==");
  const idByName = new Map();
  for (const spec of CATEGORIES) {
    const category = await ensureCategory({ tenantId: tenant.id, spec });
    idByName.set(spec.name, category.id);
  }
  return idByName;
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  seedMesaDulceCategorias()
    .then(() => console.log("Listo: categorías de mesa-dulce sincronizadas."))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeRedis();
      await prisma.$disconnect();
    });
}
