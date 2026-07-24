// Productos, combos y promo por cantidad del catálogo real de mesa-dulce.
// Idempotente por SKU/nombre: correrlo de nuevo no duplica productos/combos,
// actualiza los que cambiaron (nombre/descripción/imagen) y sincroniza la
// Promo con el catálogo vigente.
//   node prisma/mesa-dulce/productos.js
//
// Requiere que las categorías ya existan (ver ./categorias.js / index.js).
import "dotenv/config";
import { pathToFileURL } from "node:url";

import prisma from "../../lib/prisma.js";
import { closeRedis } from "../../lib/redis.js";
import { ProductModel, invalidateProductsCache } from "../../services/productos.js";
import { PromoModel } from "../../services/promos.js";
import { cld } from "../lib/seed-helpers.js";

const TENANT_SLUG = "mesa-dulce";

// Fotos reales de productos de Mesa Dulce (mismo Cloudinary, subidas por el
// admin del tenant real antes de la migración de tipos — ver
// prisma/pre-type-migration-snapshot.json). A diferencia de las de categoría
// son .png y viven en la carpeta products/.
const MD_IMG = {
  browniesClasico: { id: "e-commerce-express/products/1782519094434-545073299_c7a7bh", v: 1782519095, ext: "png" },
  browniesOreo: { id: "e-commerce-express/products/1782514272377-168062203_btlhdm", v: 1782514272, ext: "png" },
  browniesRedVelvet: { id: "e-commerce-express/products/1782515257615-37110447_ysb5sn", v: 1782515259, ext: "png" },
  rellenaKinderNutella: { id: "e-commerce-express/products/1782518646995-347947157_ccp4m4", v: 1782518647, ext: "png" },
  rellenaBonBon: { id: "e-commerce-express/products/1782518675434-443904013_bqm672", v: 1782518676, ext: "png" },
  rellenaFranui: { id: "e-commerce-express/products/1782518300466-212401095_hptmdu", v: 1782518301, ext: "png" },
  rellenaLimonFrutosRojos: { id: "e-commerce-express/products/1782518616943-916210625_mqmv98", v: 1782518617, ext: "png" },
  clasicaChip: { id: "e-commerce-express/products/1782519724803-909746124_hxtlr2", v: 1782519725, ext: "png" },
  clasicaRedVelvet: { id: "e-commerce-express/products/1782519622394-973798512_t7kfjl", v: 1782519623, ext: "png" },
  clasicaOreo: { id: "e-commerce-express/products/1782519653996-982248213_tn0bd9", v: 1782519654, ext: "png" },
  clasicaLimon: { id: "e-commerce-express/products/1782519692868-667836172_twhjgr", v: 1782519693, ext: "png" },
  // Fotos reales de los combos (mismo Cloudinary, subidas por el admin real).
  comboMesaDulce: { id: "e-commerce-express/products/1784523867259-287886989_uqr4oe", v: 1784523853, ext: "png" },
  comboFamiliar: { id: "e-commerce-express/products/1784523876521-457971566_sqapt9", v: 1784523863, ext: "png" },
  comboEntreDos: { id: "e-commerce-express/products/1784061883721-101577822_hdt39o", v: 1784061871, ext: "png" },
  comboRellenasYClasicas: { id: "e89393b5-6973-48e1-a33f-f6ca7fb4fd3b", v: 1784911557, ext: "png" },
  comboParaSorprender: { id: "fcdd6029-3395-424e-81cd-13e2883324e5", v: 1784911505, ext: "png" },
};

function mdImage(key) {
  const asset = MD_IMG[key];
  return { img: cld(asset), imgPublicId: asset.id };
}

// Catálogo tomado del panel admin real. Turrón de Avena, Pirinea y
// Chocotorta estaban excluidos en una versión anterior de este seed por no
// figurar en un dump viejo — se reincorporaron porque las capturas
// confirman que siguen a la venta. "Franuki (Copia)" no se incluye:
// aparece atenuado/sin imagen en el panel (duplicado inactivo). Faltan 2
// brownies y 1 producto más de Cookies Rellenas que la captura no deja leer
// (recortados/borrosos) — quedan pendientes para una próxima actualización.
const PRODUCTS = [
  // --- Brownies --------------------------------------------------------------
  {
    name: "Brownie Clásico",
    description: "Brownie de chocolate semiamargo y cacao amargo.",
    category: "Brownies",
    ...mdImage("browniesClasico"),
    price: 2000,
    stock: 30,
    sku: "BRW-CLS",
  },
  {
    name: "Brownie Oreo",
    description: "Brownie de chocolate con trozos de Oreo y cacao Oreo.",
    category: "Brownies",
    ...mdImage("browniesOreo"),
    price: 2600,
    stock: 30,
    sku: "BRW-ORE",
  },
  {
    name: "Brownie Red Velvet",
    description: "Brownie de vainilla, cacao amargo con cobertura de cheesecake.",
    category: "Brownies",
    ...mdImage("browniesRedVelvet"),
    price: 2000,
    stock: 30,
    sku: "BRW-RVL",
  },
  // --- Cookies Rellenas --------------------------------------------------------
  {
    name: "Kinder y Nutella",
    description: "Cookie de vainilla, kinder, rellena de nutella con líneas de chocolate semiamargo.",
    category: "Cookies Rellenas",
    ...mdImage("rellenaKinderNutella"),
    price: 4300,
    stock: 25,
    sku: "COR-KIN",
  },
  {
    // Nombre real del panel (antes seedeado como "Bon o Bon" a secas).
    name: "Bon o bon y Nutella",
    description: "Cookie de vainilla, bon o bon, rellena de nutella.",
    category: "Cookies Rellenas",
    ...mdImage("rellenaBonBon"),
    price: 4000,
    stock: 25,
    sku: "COR-BON",
  },
  {
    name: "Limón y Frutos Rojos",
    description: "Cookie de limón, pistachos, rellena de curd de limón y reducción de frutos rojos.",
    category: "Cookies Rellenas",
    ...mdImage("rellenaLimonFrutosRojos"),
    price: 3900,
    stock: 25,
    sku: "COR-LIM",
  },
  {
    name: "Red Velvet",
    description: "Cookie de vainilla, cacao amargo, chocolate blanco, rellena con ganache de chocolate blanco.",
    category: "Cookies Rellenas",
    // Sin foto real disponible (no está en el dump pre-migración).
    price: 4000,
    stock: 25,
    sku: "COR-RVL",
  },
  {
    name: "Franuí",
    description: "Masa de cacao con chips de chocolate blanco, rellena con reducción de frutos rojos y decorada con chocolate blanco y franuí.",
    category: "Cookies Rellenas",
    ...mdImage("rellenaFranui"),
    price: 4000,
    stock: 25,
    sku: "COR-FRA",
  },
  {
    name: "Turrón de Avena",
    description: "Masa de cacao y avena con trozos de chocolate semiamargo picado y galleta traviata molida, licor de chocolate, salsa de dulce de leche cubierta con virutas de chocolate semiamargo.",
    category: "Cookies Rellenas",
    price: 4000,
    stock: 25,
    sku: "COR-TUR",
  },
  {
    name: "Pirinea",
    description: "Masa de cacao con trozos de brownie, rellena con crema chantilly, dulce de leche con licor y merengue seco.",
    category: "Cookies Rellenas",
    price: 4000,
    stock: 25,
    sku: "COR-PIR",
  },
  {
    name: "Chocotorta",
    description: "Masa de cacao con licor de café, trozos de chocolate semiamargo en la masa, crema de chocotorta, alfajorcito de chocotorta bañado y cubierta con líneas de chocolate semiamargo.",
    category: "Cookies Rellenas",
    price: 4000,
    stock: 25,
    sku: "COR-CHO",
  },
  // --- Cookies Clásicas --------------------------------------------------------
  {
    name: "Chips",
    description: "Masa de vainilla con chocolate semiamargo.",
    category: "Cookies Clásicas",
    ...mdImage("clasicaChip"),
    price: 800,
    stock: 50,
    sku: "COC-CHI",
  },
  {
    name: "Red velvet",
    description: "Cookie suave y húmeda, con cacao y extracto de vainilla natural. Lleva chips de chocolate blanco.",
    category: "Cookies Clásicas",
    ...mdImage("clasicaRedVelvet"),
    price: 800,
    stock: 50,
    sku: "COC-RVL",
  },
  {
    name: "Oreo",
    description: "Combinación entre calidad de sabor y galletitas Oreo.",
    category: "Cookies Clásicas",
    ...mdImage("clasicaOreo"),
    price: 800,
    stock: 50,
    sku: "COC-ORE",
  },
  {
    // Nombre real del panel (antes seedeado solo como "Limón").
    name: "Limón y Amapolas",
    description: "Sabor suave a limón que envuelve el paladar, con amapolas para encontrar diferentes texturas dentro de la cookie. La combinación perfecta para los que buscan una opción que traiga el equilibrio.",
    category: "Cookies Clásicas",
    ...mdImage("clasicaLimon"),
    price: 800,
    stock: 50,
    sku: "COC-LIM",
  },
  {
    name: "ChocoCookie",
    description: "Masa de cacao con licor, con trozos de chocolate semiamargo.",
    category: "Cookies Clásicas",
    price: 800,
    stock: 50,
    sku: "COC-CHO",
  },
];

// Los 5 combos reales del menú. "Franuí" reemplaza al "Franuki" del pedido
// original (typo confirmado: no hay un sabor "Franuki" activo, es el mismo
// producto que ya está en Cookies Rellenas). COMBO PARA ALEGRAR y COMBO
// PARA ENAMORAR siguen afuera: el panel real los muestra pero todavía no se
// confirmó su composición.
const COMBOS = [
  {
    name: "Combo Mesa Dulce",
    price: 11000,
    description: "Incluye 4 brownies y 6 cookies clásicas.",
    ...mdImage("comboMesaDulce"),
    categoryOptions: [
      { category: "Brownies", minQty: 4, maxQty: 4 },
      { category: "Cookies Clásicas", minQty: 6, maxQty: 6 },
    ],
  },
  {
    name: "Combo Familiar",
    price: 18000,
    description: "Incluye 6 brownies y 12 cookies clásicas.",
    ...mdImage("comboFamiliar"),
    categoryOptions: [
      { category: "Brownies", minQty: 6, maxQty: 6 },
      { category: "Cookies Clásicas", minQty: 12, maxQty: 12 },
    ],
  },
  {
    name: "Combo Entre Dos",
    price: 8500,
    description: "1 Cookie Rellena a elección, 4 Cookies Clásicas a elección y 1 Brownie a elección.",
    ...mdImage("comboEntreDos"),
    categoryOptions: [
      { category: "Cookies Rellenas", minQty: 1, maxQty: 1 },
      { category: "Brownies", minQty: 1, maxQty: 1 },
      { category: "Cookies Clásicas", minQty: 4, maxQty: 4 },
    ],
  },
  {
    name: "Rellenas y Clásicas",
    price: 19000,
    description: "Este combo definitivamente, es para los amantes de las cookies :) Incluye 3 cookies rellenas y 12 cookies clásicas.",
    ...mdImage("comboRellenasYClasicas"),
    categoryOptions: [
      {
        category: "Cookies Rellenas",
        minQty: 3,
        maxQty: 3,
        // Whitelist explícita: no todas las rellenas entran a este combo.
        products: ["Kinder y Nutella", "Bon o bon y Nutella", "Red Velvet", "Limón y Frutos Rojos", "Franuí"],
      },
      { category: "Cookies Clásicas", minQty: 12, maxQty: 12 },
    ],
  },
  {
    name: "COMBO PARA SORPRENDER",
    price: 11500,
    description: "Incluye 2 Cookies rellenas a elección y 6 Cookies clásicas a elección.",
    ...mdImage("comboParaSorprender"),
    categoryOptions: [
      { category: "Cookies Rellenas", minQty: 2, maxQty: 2 },
      { category: "Cookies Clásicas", minQty: 6, maxQty: 6 },
    ],
  },
];

const PROMO_NAME = "Promo por cantidad";
const PROMO_TIERS = [
  { minQty: 3, discountPercentage: 10 },
  { minQty: 6, discountPercentage: 20 },
];

async function categoryIdByName(tenantId, name) {
  const category = await prisma.categories.findFirst({ where: { tenantId, name } });
  if (!category) {
    throw new Error(
      `Categoría "${name}" no encontrada para mesa-dulce — corré antes ./categorias.js (o "pnpm seed:mesa-dulce:categorias").`
    );
  }
  return category.id;
}

async function productIdByName(tenantId, categoryId, name) {
  const product = await prisma.product.findFirst({ where: { tenantId, categoryId, name } });
  if (!product) {
    throw new Error(
      `Producto "${name}" no encontrado en la categoría (id ${categoryId}) para mesa-dulce — ¿corrió el bloque de productos antes que el de combos?`
    );
  }
  return product.id;
}

// Idempotente por SKU (identidad estable aunque el producto se renombre).
// Si ya existe, sincroniza nombre/descripción/imagen/categoría cuando
// cambiaron; si no, lo crea.
async function ensureProduct({ tenantId, spec, categoryId }) {
  const existingVariant = await prisma.productVariant.findUnique({
    where: { tenantId_sku: { tenantId, sku: spec.sku } },
    include: { product: true },
  });

  if (!existingVariant) {
    const created = await prisma.product.create({
      data: {
        tenantId,
        name: spec.name,
        description: spec.description ?? null,
        type: "PRODUCTO",
        price: null,
        img: spec.img ?? null,
        imgPublicId: spec.imgPublicId ?? null,
        categoryId,
        isActive: true,
        variants: {
          create: [
            {
              tenantId,
              attributes: {},
              price: spec.price,
              stock: spec.stock,
              sku: spec.sku,
              img: spec.img ?? null,
              imgPublicId: spec.imgPublicId ?? null,
              isActive: true,
              isDefault: true,
            },
          ],
        },
      },
    });
    console.log(`  -> producto "${spec.name}" creado (id ${created.id}), $${spec.price}`);
    return { product: created, created: true };
  }

  const product = existingVariant.product;
  const needsUpdate =
    product.name !== spec.name ||
    product.description !== (spec.description ?? null) ||
    product.img !== (spec.img ?? null) ||
    product.imgPublicId !== (spec.imgPublicId ?? null) ||
    product.categoryId !== categoryId;

  if (!needsUpdate) {
    console.log(`  -> producto "${spec.name}" ya está al día (id ${product.id}), se omite`);
    return { product, created: false };
  }

  const updated = await prisma.product.update({
    where: { id: product.id },
    data: {
      name: spec.name,
      description: spec.description ?? null,
      img: spec.img ?? null,
      imgPublicId: spec.imgPublicId ?? null,
      categoryId,
    },
  });
  console.log(`  -> producto "${spec.name}" (id ${product.id}) actualizado`);
  return { product: updated, created: false };
}

// Idempotente por nombre (los combos no se renombran). Si ya existe,
// sincroniza descripción/imagen; la composición no se toca en el update
// (todavía no hace falta re-armar comboCategoryOptions de un combo vigente).
async function ensureCombo({ tenantId, spec, combosCategoryId }) {
  const existing = await prisma.product.findFirst({ where: { tenantId, name: spec.name } });

  if (existing) {
    const needsUpdate =
      existing.description !== (spec.description ?? null) ||
      existing.img !== (spec.img ?? null) ||
      existing.imgPublicId !== (spec.imgPublicId ?? null);

    if (!needsUpdate) {
      console.log(`  -> combo "${spec.name}" ya está al día (id ${existing.id}), se omite`);
      return { product: existing, created: false };
    }

    const updated = await prisma.product.update({
      where: { id: existing.id },
      data: {
        description: spec.description ?? null,
        img: spec.img ?? null,
        imgPublicId: spec.imgPublicId ?? null,
      },
    });
    console.log(`  -> combo "${spec.name}" (id ${existing.id}) actualizado (descripción/imagen)`);
    return { product: updated, created: false };
  }

  const comboCategoryOptions = await Promise.all(
    spec.categoryOptions.map(async (option) => {
      const categoryId = await categoryIdByName(tenantId, option.category);
      const productIds = option.products
        ? await Promise.all(option.products.map((name) => productIdByName(tenantId, categoryId, name)))
        : undefined;
      return { categoryId, minQty: option.minQty, maxQty: option.maxQty, productIds };
    })
  );

  const created = await ProductModel.create({
    tenantId,
    name: spec.name,
    description: spec.description ?? null,
    img: spec.img ?? null,
    imgPublicId: spec.imgPublicId ?? null,
    categoryId: combosCategoryId,
    price: spec.price,
    type: "COMBO",
    comboCategoryOptions,
  });
  console.log(`  -> combo "${spec.name}" creado (id ${created.id}), $${spec.price}`);
  return { product: created, created: true };
}

async function syncPromo(tenantId) {
  const products = await prisma.product.findMany({
    where: { tenantId, type: "PRODUCTO" },
    select: { id: true },
  });
  const productIds = products.map((p) => p.id);

  const existing = await prisma.promo.findFirst({ where: { tenantId, name: PROMO_NAME } });

  if (!existing) {
    const created = await PromoModel.create({
      tenantId,
      name: PROMO_NAME,
      tiers: PROMO_TIERS,
      productIds,
    });
    console.log(`  -> promo "${PROMO_NAME}" creada (id ${created.id}) con ${productIds.length} productos`);
    return created;
  }

  const updated = await PromoModel.edit({
    tenantId,
    id: existing.id,
    tiers: PROMO_TIERS,
    productIds,
  });
  console.log(`  -> promo "${PROMO_NAME}" (id ${existing.id}) sincronizada con ${productIds.length} productos`);
  return updated;
}

export async function seedMesaDulceProductos() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) {
    throw new Error(
      `Tenant "${TENANT_SLUG}" no encontrado. Corré primero "pnpm seed" (o creá el tenant a mano) antes de este script.`
    );
  }
  const tenantId = tenant.id;

  console.log("== Productos de mesa-dulce ==");
  let productsCreated = 0;
  for (const spec of PRODUCTS) {
    const categoryId = await categoryIdByName(tenantId, spec.category);
    const { created } = await ensureProduct({ tenantId, spec, categoryId });
    if (created) productsCreated += 1;
  }

  console.log("== Combos de mesa-dulce ==");
  const combosCategoryId = await categoryIdByName(tenantId, "Combos");
  let combosCreated = 0;
  for (const spec of COMBOS) {
    const { created } = await ensureCombo({ tenantId, spec, combosCategoryId });
    if (created) combosCreated += 1;
  }

  await invalidateProductsCache(tenantId);

  console.log("== Promo por cantidad de mesa-dulce ==");
  await syncPromo(tenantId);

  return { productsCreated, combosCreated };
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  seedMesaDulceProductos()
    .then(() => console.log("Listo: productos, combos y promo de mesa-dulce sincronizados."))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeRedis();
      await prisma.$disconnect();
    });
}
