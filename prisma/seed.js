import "dotenv/config";

import prisma from "../lib/prisma.js";
import { hashPassword } from "../helpers/password.js";
import { seedTenantConfigs } from "./seed-tenant-config.js";

const PASSWORD_PLAIN = "password123";

// ---------------------------------------------------------------------------
// Imágenes (Cloudinary del proyecto). Para sumar/cambiar imágenes, editá este
// mapa: { id: <public_id sin extensión>, v: <version> }. La URL se arma con
// q_auto/f_auto para que el front las reciba optimizadas.
// La idea a futuro: cada tenant tiene su carpeta de assets y este mapa se
// genera por tenant (ej. Media/<slug>).
// ---------------------------------------------------------------------------
const CLOUD_NAME = "dqukj1pac";

function cld({ id, v }) {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/q_auto/f_auto/v${v}/${id}.jpg`;
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

const PAYMENT_BY_STATUS = {
  COMPLETED: "APPROVED",
  PROCESSING: "IN_PROCESS",
  PENDING: "PENDING",
  CANCELLED: "REJECTED",
};

function daysAgo(n) {
  const date = new Date();
  date.setDate(date.getDate() - n);
  date.setHours(12, 30, 0, 0);
  return date;
}

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

const ACME_PRODUCTS = [
  // --- Remeras -------------------------------------------------------------
  {
    name: "Remera oversize studio",
    description: "Calce oversize de algodón premium.",
    category: "Remeras",
    ...image("remeras1"),
    variants: [
      { color: "Negro", size: "S", price: 14990, stock: 40, sku: "TEE-STD-BLK-S", ...image("remeras1") },
      { color: "Negro", size: "M", price: 14990, stock: 25, sku: "TEE-STD-BLK-M", ...image("remeras1") },
      // Sin stock: con showOutOfStock=false NO debería aparecer en la tienda.
      { color: "Crema", size: "L", price: 14990, stock: 0, sku: "TEE-STD-CRM-L", ...image("remeras2") },
    ],
  },
  {
    name: "Remera graphic caramelus",
    description: "Estampa frontal edición limitada.",
    category: "Remeras",
    price: 16990, // precio a nivel producto: las variantes con price null lo heredan
    ...image("remeras5"),
    variants: [
      { color: "Crema", size: "M", price: null, stock: 18, sku: "TEE-CAR-CRM-M", ...image("remeras5") },
      { color: "Crema", size: "L", price: null, stock: 6, sku: "TEE-CAR-CRM-L", ...image("remeras5") }, // poco stock
    ],
  },
  {
    name: "Remera midnights tour",
    description: "Remera de tour con back print.",
    category: "Remeras",
    ...image("remeras6"),
    variants: [
      { color: "Crema", size: "M", price: 15990, stock: 30, sku: "TEE-MID-CRM-M", ...image("remeras6") },
      { color: "Crema", size: "L", price: 15990, stock: 12, sku: "TEE-MID-CRM-L", ...image("remeras6") },
    ],
  },
  {
    name: "Remera boxy essential",
    description: "Boxy fit de uso diario.",
    category: "Remeras",
    ...image("remeras4"),
    variants: [
      { color: "Verde", size: "M", price: 13990, stock: 22, sku: "TEE-BOX-GRN-M", ...image("remeras10") },
      { color: "Negro", size: "L", price: 13990, stock: 0, sku: "TEE-BOX-BLK-L", ...image("remeras4") }, // sin stock
    ],
  },
  {
    name: "Remera phoebe vintage",
    description: "Lavado vintage con gráfica grande.",
    category: "Remeras",
    ...image("remeras7"),
    variants: [
      { color: "Gris", size: "M", price: 17990, stock: 9, sku: "TEE-PHO-GRY-M", ...image("remeras7") },
      { color: "Gris", size: "L", price: 17990, stock: 4, sku: "TEE-PHO-GRY-L", ...image("remeras7") }, // poco stock
    ],
  },
  // --- Zapatillas ----------------------------------------------------------
  {
    name: "Zapatillas retro court",
    description: "Sneaker retro de suela gum.",
    category: "Zapatillas",
    ...image("zapas1"),
    variants: [
      { color: "Blanco", size: "40", price: 39990, stock: 10, sku: "ZAP-CRT-WHT-40", ...image("zapas1") },
      { color: "Blanco", size: "41", price: 39990, stock: 7, sku: "ZAP-CRT-WHT-41", ...image("zapas1") },
      { color: "Blanco", size: "42", price: 39990, stock: 0, sku: "ZAP-CRT-WHT-42", ...image("zapas2") }, // sin stock
    ],
  },
  {
    name: "Zapatillas suede gum",
    description: "Gamuza premium con detalles contrastados.",
    category: "Zapatillas",
    ...image("zapas4"),
    variants: [
      { color: "Marron", size: "41", price: 45990, stock: 5, sku: "ZAP-SDE-BRN-41", ...image("zapas4") },
      { color: "Marron", size: "42", price: 45990, stock: 3, sku: "ZAP-SDE-BRN-42", ...image("zapas4") }, // poco stock
    ],
  },
  {
    name: "Zapatillas skate pro",
    description: "Silueta skate reforzada.",
    category: "Zapatillas",
    price: 42990, // precio a nivel producto
    ...image("zapas6"),
    variants: [
      { color: "Azul", size: "42", price: null, stock: 14, sku: "ZAP-SKT-BLU-42", ...image("zapas6") },
      { color: "Azul", size: "43", price: null, stock: 8, sku: "ZAP-SKT-BLU-43", ...image("zapas7") },
    ],
  },
  // --- Gorras --------------------------------------------------------------
  {
    name: "Gorra vintage LA",
    description: "Gorra washed con bordado.",
    category: "Gorras",
    ...image("gorras2"),
    variants: [
      { color: "Negro", size: "U", price: 11990, stock: 20, sku: "CAP-LA-BLK-U", ...image("gorras2") },
      { color: "Azul", size: "U", price: 11990, stock: 15, sku: "CAP-LA-BLU-U", ...image("gorras8") },
    ],
  },
  {
    name: "Gorra surf trip",
    description: "Gorra de corderoy two-tone.",
    category: "Gorras",
    ...image("gorras5"),
    variants: [
      { color: "Celeste", size: "U", price: 12990, stock: 0, sku: "CAP-SRF-CEL-U", ...image("gorras5") }, // sin stock
      { color: "Crema", size: "U", price: 12990, stock: 11, sku: "CAP-SRF-CRM-U", ...image("gorras7") },
    ],
  },
  {
    name: "Gorra countryside",
    description: "Gorra trucker edición campo.",
    category: "Gorras",
    ...image("gorras9"),
    variants: [
      { color: "Verde", size: "U", price: 13990, stock: 6, sku: "CAP-CTR-GRN-U", ...image("gorras9") }, // poco stock
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
  { status: "PENDING", daysAgo: 1, items: [{ sku: "ZAP-SKT-BLU-42", quantity: 1 }] },
  { status: "CANCELLED", daysAgo: 8, items: [{ sku: "CAP-SRF-CRM-U", quantity: 1 }] },
];

// ---------------------------------------------------------------------------
// Datos de SHOPCO (catálogo chico, sin imágenes, para validar multi-tenant).
// ---------------------------------------------------------------------------
const SHOPCO_CATEGORIES = [
  { name: "Electrónica", icon: "cpu", description: "Gadgets y accesorios" },
  { name: "Audio", parent: "Electrónica", icon: "headphones", description: "Auriculares y parlantes" },
];

const SHOPCO_PRODUCTS = [
  {
    name: "Auriculares BT",
    description: "Bluetooth 5.0 con cancelación de ruido.",
    category: "Audio",
    variants: [
      { color: "Negro", size: null, price: 25000, stock: 15, sku: "SHC-AUR-N" },
      { color: "Blanco", size: null, price: 25000, stock: 3, sku: "SHC-AUR-B" }, // poco stock
    ],
  },
  {
    name: "Parlante portátil",
    description: "Resistente al agua, 12h de batería.",
    category: "Audio",
    price: 18000,
    variants: [
      // shopco tiene showOutOfStock=true: este SÍ debería verse aunque esté en 0.
      { color: "Negro", size: null, price: null, stock: 0, sku: "SHC-PAR-N" },
    ],
  },
];

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

async function seedProducts(tenantId, categoryIdByName, specs) {
  for (const p of specs) {
    await prisma.product.create({
      data: {
        tenantId,
        name: p.name,
        description: p.description ?? null,
        price: p.price ?? null,
        img: p.img ?? null,
        imgPublicId: p.imgPublicId ?? null,
        categoryId: categoryIdByName.get(p.category) ?? null,
        isActive: p.isActive ?? true,
        variants: {
          create: p.variants.map((v) => ({
            tenantId,
            color: v.color ?? null,
            size: v.size ?? null,
            price: v.price ?? null,
            stock: v.stock,
            sku: v.sku,
            img: v.img ?? null,
            imgPublicId: v.imgPublicId ?? null,
            isActive: v.isActive ?? true,
          })),
        },
      },
    });
  }
}

async function variantBySku(tenantId, sku) {
  return prisma.productVariant.findUnique({
    where: { tenantId_sku: { tenantId, sku } },
    include: { product: { select: { price: true } } },
  });
}

async function seedCartForUser({ tenantId, userId, items }) {
  const cart = await prisma.cart.create({ data: { tenantId, userId } });

  for (const item of items) {
    const variant = await variantBySku(tenantId, item.sku);
    if (!variant) continue;

    await prisma.cartItem.create({
      data: { cartId: cart.id, variantId: variant.id, quantity: item.quantity },
    });
  }

  return cart;
}

async function seedOrdersForUser({ tenantId, userId, orders }) {
  let created = 0;

  for (const spec of orders) {
    const items = [];

    for (const line of spec.items) {
      const variant = await variantBySku(tenantId, line.sku);
      if (!variant) continue;
      // Precio efectivo: variante o, si es null, el del producto.
      const price = variant.price ?? variant.product.price ?? 0;
      items.push({ variantId: variant.id, quantity: line.quantity, price });
    }

    if (!items.length) continue;

    const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const createdAt = daysAgo(spec.daysAgo);

    await prisma.order.create({
      data: {
        tenantId,
        userId,
        status: spec.status,
        total,
        paymentStatus: PAYMENT_BY_STATUS[spec.status],
        paymentMethod: "seed-order",
        paymentId: `seed-order-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt,
        updatedAt: createdAt,
        orderItems: { create: items },
      },
    });

    created += 1;
  }

  return created;
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
      "OrderItem", "Order",
      "ProductVariant", "Product", "Categories",
      "TenantConfig",
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

  const shopcoCategories = await seedCategories(shopco.id, SHOPCO_CATEGORIES);
  await seedProducts(shopco.id, shopcoCategories, SHOPCO_PRODUCTS);

  console.log("\n=== Seed completado ===\n");
  for (const t of [acme, shopco]) {
    console.log(`Tenant: ${t.name} (slug: ${t.slug}, id: ${t.id})`);
    for (const u of t.users) {
      console.log(`  ${u.role}: ${u.username} (${u.email}) / ${PASSWORD_PLAIN}`);
    }
    console.log();
  }
  console.log(`acme: ${ACME_PRODUCTS.length} productos, carrito con ${ACME_CART.length} items, ${acmeOrders} órdenes`);
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
