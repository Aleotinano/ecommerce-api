import "dotenv/config";

import prisma from "../lib/prisma.js";
import { hashPassword } from "../helpers/password.js";
import { seedTenantConfigs } from "./seed-tenant-config.js";
import { variantBySku, seedOrdersForUser } from "./lib/seed-helpers.js";
import { seedMesaDulceCategorias } from "./mesa-dulce/categorias.js";
import { seedMesaDulceProductos } from "./mesa-dulce/productos.js";
import { seedMesaDulceOrdenes } from "./mesa-dulce/ordenes.js";

const PASSWORD_PLAIN = "password123";

// ---------------------------------------------------------------------------
// Imágenes (Cloudinary del proyecto). Para sumar/cambiar imágenes, editá este
// mapa: { id: <public_id sin extensión>, v: <version> }. La URL se arma con
// q_auto/f_auto para que el front las reciba optimizadas.
// La idea a futuro: cada tenant tiene su carpeta de assets y este mapa se
// genera por tenant (ej. Media/<slug>).
// ---------------------------------------------------------------------------
const CLOUD_NAME = "dqukj1pac";

function cld({ id, v, ext = "jpg" }) {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/q_auto/f_auto/v${v}/${id}.${ext}`;
}

const IMG = {
  remeras1: { id: "remeras1_be9eth", v: 1780695232 },
  remeras2: { id: "remeras2_zduduj", v: 1780695232 },
  remeras3: { id: "remeras3_omjmpu", v: 1780695233 },
  remeras4: { id: "remeras4_vekh5y", v: 1780695234 },
  remeras5: { id: "remeras5_cst9bm", v: 1780695235 },
  remeras6: { id: "remeras6_y8nodr", v: 1780695235 },
  remeras7: { id: "remeras7_qix4md", v: 1780695236 },
  remeras8: { id: "remeras8_xmxm09", v: 1780695216 },
  remeras9: { id: "remeras9_w6hke7", v: 1780695216 },
  remeras10: { id: "remeras10_tdqgec", v: 1780695216 },
  gorras1: { id: "gorras1_ocfwj2", v: 1780695224 },
  gorras2: { id: "gorras2_sbg2ig", v: 1780695224 },
  gorras3: { id: "gorras3_soexzj", v: 1780695225 },
  gorras4: { id: "gorras4_wle7c1", v: 1780695226 },
  gorras5: { id: "gorras5_ysqph7", v: 1780695227 },
  gorras6: { id: "gorras6_woptfo", v: 1780695227 },
  gorras7: { id: "gorras7_xclyeb", v: 1780695228 },
  gorras8: { id: "gorras8_fi6rda", v: 1780695229 },
  gorras9: { id: "gorras9_hcuhpc", v: 1780695229 },
  zapas1: { id: "zapas1_jykm9h", v: 1780695217 },
  zapas2: { id: "zapas2_tkhm49", v: 1780695217 },
  zapas3: { id: "zapas3_n2t5ke", v: 1780695217 },
  zapas4: { id: "zapas4_jv5zju", v: 1780695218 },
  zapas5: { id: "zapas5_yqmxzu", v: 1780695219 },
  zapas6: { id: "zapas6_oal8il", v: 1780695220 },
  zapas7: { id: "zapas7_fxjqic", v: 1780695220 },
  zapas8: { id: "zapas8_ev8mhs", v: 1780695221 },
  zapas9: { id: "zapas9_on66uj", v: 1780695222 },
};

// Devuelve { img, imgPublicId } listo para spread en producto/variante.
function image(key) {
  const asset = IMG[key];
  return { img: cld(asset), imgPublicId: asset.id };
}

// Las fotos e imágenes reales del catálogo de Mesa Dulce, así como su lista de
// productos/combos/promos, viven ahora en ./mesa-dulce/ (ver import arriba) —
// dejaron de estar hardcodeadas acá para poder actualizarse sin tocar el seed
// monolítico de los 3 tenants.

// ---------------------------------------------------------------------------
// Datos de ACME (catálogo rico: jerarquía + íconos + imágenes reales + stock
// variado para testear showOutOfStock y poco stock).
// ---------------------------------------------------------------------------
const ACME_CATEGORIES = [
  // Padres
  { name: "Indumentaria", icon: "shirt", description: "Ropa y básicos urbanos" },
  { name: "Calzado", icon: "footprints", description: "Zapatillas y sneakers" },
  { name: "Accesorios", icon: "tag", description: "Complementos y accesorios" },
  // Hijas
  { name: "Remeras", parent: "Indumentaria", icon: "shirt", description: "Remeras y oversize" },
  { name: "Zapatillas", parent: "Calzado", icon: "footprints", description: "Sneakers urbanas" },
  { name: "Gorras", parent: "Accesorios", icon: "tag", description: "Gorras y caps" },
];

// Catálogo de atributos de variante por tenant (seteo one-time del onboarding).
// acme es una tienda de ropa: color (swatch HEX) + talle.
const ACME_ATTRIBUTES = [
  { key: "color", label: "Color", type: "COLOR" },
  { key: "talle", label: "Talle", type: "TEXT" },
];

const ACME_PRODUCTS = [
  // --- Remeras -------------------------------------------------------------
  {
    name: "Remera oversize studio",
    description: "Calce oversize de algodón premium.",
    category: "Remeras",
    ...image("remeras1"),
    variants: [
      { attributes: { color: "#000000", talle: "S" }, price: 14990, stock: 40, sku: "TEE-STD-BLK-S", ...image("remeras1") },
      { attributes: { color: "#000000", talle: "M" }, price: 14990, stock: 25, sku: "TEE-STD-BLK-M", ...image("remeras1") },
      // Sin stock: con showOutOfStock=false NO debería aparecer en la tienda.
      { attributes: { color: "#F5F5DC", talle: "L" }, price: 14990, stock: 0, sku: "TEE-STD-CRM-L", ...image("remeras2") },
    ],
  },
  {
    name: "Remera graphic caramelus",
    description: "Estampa frontal edición limitada.",
    category: "Remeras",
    ...image("remeras5"),
    variants: [
      { attributes: { color: "#F5F5DC", talle: "M" }, price: 16990, stock: 18, sku: "TEE-CAR-CRM-M", ...image("remeras5") },
      { attributes: { color: "#F5F5DC", talle: "L" }, price: 16990, stock: 6, sku: "TEE-CAR-CRM-L", ...image("remeras5") }, // poco stock
    ],
  },
  {
    name: "Remera midnights tour",
    description: "Remera de tour con back print.",
    category: "Remeras",
    ...image("remeras6"),
    variants: [
      { attributes: { color: "#F5F5DC", talle: "M" }, price: 15990, stock: 30, sku: "TEE-MID-CRM-M", ...image("remeras6") },
      { attributes: { color: "#F5F5DC", talle: "L" }, price: 15990, stock: 12, sku: "TEE-MID-CRM-L", ...image("remeras6") },
    ],
  },
  {
    name: "Remera boxy essential",
    description: "Boxy fit de uso diario.",
    category: "Remeras",
    ...image("remeras4"),
    variants: [
      { attributes: { color: "#2E7D32", talle: "M" }, price: 13990, stock: 22, sku: "TEE-BOX-GRN-M", ...image("remeras10") },
      { attributes: { color: "#000000", talle: "L" }, price: 13990, stock: 0, sku: "TEE-BOX-BLK-L", ...image("remeras4") }, // sin stock
    ],
  },
  {
    name: "Remera phoebe vintage",
    description: "Lavado vintage con gráfica grande.",
    category: "Remeras",
    ...image("remeras7"),
    variants: [
      { attributes: { color: "#808080", talle: "M" }, price: 17990, stock: 9, sku: "TEE-PHO-GRY-M", ...image("remeras7") },
      { attributes: { color: "#808080", talle: "L" }, price: 17990, stock: 4, sku: "TEE-PHO-GRY-L", ...image("remeras7") }, // poco stock
    ],
  },
  // --- Zapatillas ----------------------------------------------------------
  {
    name: "Zapatillas retro court",
    description: "Sneaker retro de suela gum.",
    category: "Zapatillas",
    ...image("zapas1"),
    variants: [
      { attributes: { color: "#FFFFFF", talle: "40" }, price: 39990, stock: 10, sku: "ZAP-CRT-WHT-40", ...image("zapas1") },
      { attributes: { color: "#FFFFFF", talle: "41" }, price: 39990, stock: 7, sku: "ZAP-CRT-WHT-41", ...image("zapas1") },
      { attributes: { color: "#FFFFFF", talle: "42" }, price: 39990, stock: 0, sku: "ZAP-CRT-WHT-42", ...image("zapas2") }, // sin stock
    ],
  },
  {
    name: "Zapatillas suede gum",
    description: "Gamuza premium con detalles contrastados.",
    category: "Zapatillas",
    ...image("zapas4"),
    variants: [
      { attributes: { color: "#5C4033", talle: "41" }, price: 45990, stock: 5, sku: "ZAP-SDE-BRN-41", ...image("zapas4") },
      { attributes: { color: "#5C4033", talle: "42" }, price: 45990, stock: 3, sku: "ZAP-SDE-BRN-42", ...image("zapas4") }, // poco stock
    ],
  },
  {
    name: "Zapatillas skate pro",
    description: "Silueta skate reforzada.",
    category: "Zapatillas",
    ...image("zapas6"),
    variants: [
      { attributes: { color: "#1E3A8A", talle: "42" }, price: 42990, stock: 14, sku: "ZAP-SKT-BLU-42", ...image("zapas6") },
      { attributes: { color: "#1E3A8A", talle: "43" }, price: 42990, stock: 8, sku: "ZAP-SKT-BLU-43", ...image("zapas7") },
    ],
  },
  // --- Gorras --------------------------------------------------------------
  {
    name: "Gorra vintage LA",
    description: "Gorra washed con bordado.",
    category: "Gorras",
    ...image("gorras2"),
    variants: [
      { attributes: { color: "#000000", talle: "U" }, price: 11990, stock: 20, sku: "CAP-LA-BLK-U", ...image("gorras2") },
      { attributes: { color: "#1E3A8A", talle: "U" }, price: 11990, stock: 15, sku: "CAP-LA-BLU-U", ...image("gorras8") },
    ],
  },
  {
    name: "Gorra surf trip",
    description: "Gorra de corderoy two-tone.",
    category: "Gorras",
    ...image("gorras5"),
    variants: [
      { attributes: { color: "#87CEEB", talle: "U" }, price: 12990, stock: 0, sku: "CAP-SRF-CEL-U", ...image("gorras5") }, // sin stock
      { attributes: { color: "#F5F5DC", talle: "U" }, price: 12990, stock: 11, sku: "CAP-SRF-CRM-U", ...image("gorras7") },
    ],
  },
  {
    name: "Gorra countryside",
    description: "Gorra trucker edición campo.",
    category: "Gorras",
    ...image("gorras9"),
    variants: [
      { attributes: { color: "#2E7D32", talle: "U" }, price: 13990, stock: 6, sku: "CAP-CTR-GRN-U", ...image("gorras9") }, // poco stock
    ],
  },
];

// Carrito precargado del customer de acme (para testear /store/cart).
const ACME_CART = [
  { sku: "TEE-STD-BLK-M", quantity: 1 },
  { sku: "ZAP-CRT-WHT-41", quantity: 1 },
];

// Órdenes del customer de acme en distintos estados (para /store/orders).
const ACME_ORDERS = [
  { status: "COMPLETED", daysAgo: 5, items: [{ sku: "TEE-STD-BLK-M", quantity: 1 }, { sku: "CAP-LA-BLK-U", quantity: 2 }] },
  { status: "COMPLETED", daysAgo: 12, items: [{ sku: "ZAP-SDE-BRN-41", quantity: 1 }] },
  { status: "PROCESSING", daysAgo: 2, items: [{ sku: "TEE-MID-CRM-L", quantity: 1 }, { sku: "TEE-PHO-GRY-M", quantity: 1 }] },
  { status: "NEW", daysAgo: 1, items: [{ sku: "ZAP-SKT-BLU-42", quantity: 1 }] },
  { status: "CANCELLED", daysAgo: 8, items: [{ sku: "CAP-SRF-CRM-U", quantity: 1 }] },
];

// ---------------------------------------------------------------------------
// Datos de SHOPCO (catálogo chico, sin imágenes, para validar multi-tenant).
// ---------------------------------------------------------------------------
const SHOPCO_CATEGORIES = [
  { name: "Electrónica", icon: "cpu", description: "Gadgets y accesorios" },
  { name: "Audio", parent: "Electrónica", icon: "headphones", description: "Auriculares y parlantes" },
];

// shopco vende electrónica: solo color como atributo de variante.
const SHOPCO_ATTRIBUTES = [{ key: "color", label: "Color", type: "COLOR" }];

const SHOPCO_PRODUCTS = [
  {
    name: "Auriculares BT",
    description: "Bluetooth 5.0 con cancelación de ruido.",
    category: "Audio",
    variants: [
      { attributes: { color: "#000000" }, price: 25000, stock: 15, sku: "SHC-AUR-N" },
      { attributes: { color: "#FFFFFF" }, price: 25000, stock: 3, sku: "SHC-AUR-B" }, // poco stock
    ],
  },
  {
    name: "Parlante portátil",
    description: "Resistente al agua, 12h de batería.",
    category: "Audio",
    variants: [
      // shopco tiene showOutOfStock=true: este SÍ debería verse aunque esté en 0.
      { attributes: { color: "#000000" }, price: 18000, stock: 0, sku: "SHC-PAR-N" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Datos de MESA DULCE: ver ./mesa-dulce/categorias.js y ./mesa-dulce/productos.js.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers de seeding
// ---------------------------------------------------------------------------
async function seedTenantBase({ slug, name, users }) {
  const hashed = await hashPassword(PASSWORD_PLAIN);

  return prisma.tenant.create({
    data: {
      slug,
      name,
      users: {
        create: users.map((u) => ({
          username: u.username,
          email: u.email,
          password: hashed,
          role: u.role,
          emailVerified: true,
        })),
      },
    },
    include: { users: true },
  });
}

// Crea categorías respetando la jerarquía: primero padres, después hijas.
async function seedCategories(tenantId, specs) {
  const idByName = new Map();
  const parents = specs.filter((c) => !c.parent);
  const children = specs.filter((c) => c.parent);

  for (const c of [...parents, ...children]) {
    const created = await prisma.categories.create({
      data: {
        tenantId,
        name: c.name,
        description: c.description ?? null,
        icon: c.icon ?? null,
        parentId: c.parent ? idByName.get(c.parent) : null,
      },
    });
    idByName.set(c.name, created.id);
  }

  return idByName;
}

// Catálogo de atributos del tenant (equivale al setup one-time del onboarding).
async function seedTenantAttributes(tenantId, specs) {
  await prisma.tenantAttribute.createMany({
    data: specs.map((attribute, index) => ({
      tenantId,
      key: attribute.key,
      label: attribute.label,
      type: attribute.type ?? "TEXT",
      position: index,
    })),
  });
}

async function seedProducts(tenantId, categoryIdByName, specs) {
  for (const p of specs) {
    await prisma.product.create({
      data: {
        tenantId,
        name: p.name,
        description: p.description ?? null,
        // Todos los specs son PRODUCTO: el precio vive en cada variante y la
        // primera queda como principal (isDefault).
        type: "PRODUCTO",
        price: null,
        img: p.img ?? null,
        imgPublicId: p.imgPublicId ?? null,
        categoryId: categoryIdByName.get(p.category) ?? null,
        isActive: p.isActive ?? true,
        variants: {
          create: p.variants.map((v, index) => ({
            tenantId,
            attributes: v.attributes ?? {},
            price: v.price,
            stock: v.stock,
            sku: v.sku,
            img: v.img ?? null,
            imgPublicId: v.imgPublicId ?? null,
            isActive: v.isActive ?? true,
            isDefault: index === 0,
          })),
        },
      },
    });
  }
}

async function seedCartForUser({ tenantId, userId, items }) {
  const cart = await prisma.cart.create({ data: { tenantId, userId } });

  for (const item of items) {
    const variant = await variantBySku(tenantId, item.sku);
    if (!variant) continue;

    await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        productId: variant.productId,
        variantId: variant.id,
        quantity: item.quantity,
      },
    });
  }

  return cart;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  // TRUNCATE con RESTART IDENTITY resetea los autoincrement: así el primer
  // tenant siempre queda con id=1, el primer user con id=1, etc.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "CartItem", "Cart",
      "OrderStatusHistory", "OrderItem", "Order",
      "ProductVariant", "Product", "Categories",
      "TenantAttribute", "TenantConfig",
      "User", "Tenant"
    RESTART IDENTITY CASCADE
  `);

  // --- ACME (catálogo rico + carrito + órdenes) ----------------------------
  const acme = await seedTenantBase({
    slug: "acme",
    name: "Acme Store",
    users: [
      { username: "admin_acme", email: "admin@acme.com", role: "ADMIN" },
      { username: "staff_acme", email: "staff@acme.com", role: "STAFF" },
      { username: "customer_acme", email: "customer@acme.com", role: "CUSTOMER" },
    ],
  });

  await seedTenantAttributes(acme.id, ACME_ATTRIBUTES);
  const acmeCategories = await seedCategories(acme.id, ACME_CATEGORIES);
  await seedProducts(acme.id, acmeCategories, ACME_PRODUCTS);

  const acmeCustomer = acme.users.find((u) => u.role === "CUSTOMER");
  await seedCartForUser({ tenantId: acme.id, userId: acmeCustomer.id, items: ACME_CART });
  const acmeOrders = await seedOrdersForUser({
    tenantId: acme.id,
    userId: acmeCustomer.id,
    orders: ACME_ORDERS,
  });

  // --- SHOPCO (catálogo chico) ---------------------------------------------
  const shopco = await seedTenantBase({
    slug: "shopco",
    name: "ShopCo",
    users: [
      { username: "admin_shopco", email: "admin@shopco.com", role: "ADMIN" },
      { username: "staff_shopco", email: "staff@shopco.com", role: "STAFF" },
      { username: "customer_shopco", email: "customer@shopco.com", role: "CUSTOMER" },
    ],
  });

  await seedTenantAttributes(shopco.id, SHOPCO_ATTRIBUTES);
  const shopcoCategories = await seedCategories(shopco.id, SHOPCO_CATEGORIES);
  await seedProducts(shopco.id, shopcoCategories, SHOPCO_PRODUCTS);

  // --- MESA DULCE (catálogo real, sin atributos de variante) ---------------
  // Categorías/productos/combos/promo/órdenes viven en ./mesa-dulce/*.js —
  // scripts idempotentes, reusables standalone (ver package.json seed:mesa-dulce*).
  const mesaDulce = await seedTenantBase({
    slug: "mesa-dulce",
    name: "Mesa Dulce",
    users: [
      { username: "admin_mesadulce", email: "admin@mesadulce.com", role: "ADMIN" },
      { username: "staff_mesadulce", email: "staff@mesadulce.com", role: "STAFF" },
      { username: "customer_mesadulce", email: "customer@mesadulce.com", role: "CUSTOMER" },
    ],
  });

  await seedMesaDulceCategorias();
  const { productsCreated: mesaDulceProducts } = await seedMesaDulceProductos();
  const mesaDulceOrders = await seedMesaDulceOrdenes();

  console.log("\n=== Seed completado ===\n");
  for (const t of [acme, shopco, mesaDulce]) {
    console.log(`Tenant: ${t.name} (slug: ${t.slug}, id: ${t.id})`);
    for (const u of t.users) {
      console.log(`  ${u.role}: ${u.username} (${u.email}) / ${PASSWORD_PLAIN}`);
    }
    console.log();
  }
  console.log(`acme: ${ACME_PRODUCTS.length} productos, carrito con ${ACME_CART.length} items, ${acmeOrders} órdenes`);
  console.log(`mesa-dulce: ${mesaDulceProducts} productos, ${mesaDulceOrders} órdenes (seña)`);
  console.log();

  console.log("--- Tenant configs ---");
  await seedTenantConfigs();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
