import "dotenv/config";

import prisma from "../lib/prisma.js";
import { hashPassword } from "../helpers/password.js";
import { seedTenantConfigs } from "./seed-tenant-config.js";

const PASSWORD_PLAIN = "password123";

async function seedTenant({ slug, name, adminUsername, adminEmail, staffUsername, staffEmail, customerUsername, customerEmail, categories }) {
  const hashed = await hashPassword(PASSWORD_PLAIN);

  const tenant = await prisma.tenant.create({
    data: {
      slug,
      name,
      users: {
        create: [
          {
            username: adminUsername,
            email: adminEmail,
            password: hashed,
            role: "ADMIN",
            emailVerified: true,
          },
          {
            username: staffUsername,
            email: staffEmail,
            password: hashed,
            role: "STAFF",
            emailVerified: true,
          },
          {
            username: customerUsername,
            email: customerEmail,
            password: hashed,
            role: "CUSTOMER",
            emailVerified: true,
          },
        ],
      },
    },
    include: { users: true },
  });

  for (const cat of categories) {
    await prisma.categories.create({
      data: {
        tenantId: tenant.id,
        name: cat.name,
        description: cat.description,
        products: {
          create: cat.products.map((p) => ({
            tenantId: tenant.id,
            name: p.name,
            description: p.description,
            variants: {
              create: p.variants.map((v) => ({
                tenantId: tenant.id,
                color: v.color,
                size: v.size,
                price: v.price,
                stock: v.stock,
                sku: v.sku,
              })),
            },
          })),
        },
      },
    });
  }

  return tenant;
}

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

  const acme = await seedTenant({
    slug: "acme",
    name: "Acme Store",
    adminUsername: "admin_acme",
    adminEmail: "admin@acme.com",
    staffUsername: "staff_acme",
    staffEmail: "staff@acme.com",
    customerUsername: "customer_acme",
    customerEmail: "customer@acme.com",
    categories: [
      {
        name: "Remeras",
        description: "Indumentaria superior",
        products: [
          {
            name: "Remera básica",
            description: "Algodón 100%",
            variants: [
              { color: "negro", size: "M", price: 4500, stock: 10, sku: "ACM-REM-NM" },
              { color: "blanco", size: "L", price: 4500, stock: 5, sku: "ACM-REM-BL" },
            ],
          },
        ],
      },
      {
        name: "Pantalones",
        description: "Jeans y joggers",
        products: [
          {
            name: "Jean clásico",
            description: "Corte recto",
            variants: [
              { color: "azul", size: "42", price: 12000, stock: 8, sku: "ACM-JEAN-42" },
            ],
          },
        ],
      },
    ],
  });

  const shopco = await seedTenant({
    slug: "shopco",
    name: "ShopCo",
    adminUsername: "admin_shopco",
    adminEmail: "admin@shopco.com",
    staffUsername: "staff_shopco",
    staffEmail: "staff@shopco.com",
    customerUsername: "customer_shopco",
    customerEmail: "customer@shopco.com",
    categories: [
      {
        name: "Electrónica",
        description: "Gadgets y accesorios",
        products: [
          {
            name: "Auriculares BT",
            description: "Bluetooth 5.0",
            variants: [
              { color: "negro", size: null, price: 25000, stock: 15, sku: "SHC-AUR-N" },
              { color: "blanco", size: null, price: 25000, stock: 3, sku: "SHC-AUR-B" },
            ],
          },
        ],
      },
    ],
  });

  console.log("\n=== Seed completado ===\n");
  for (const t of [acme, shopco]) {
    console.log(`Tenant: ${t.name} (slug: ${t.slug}, id: ${t.id})`);
    for (const u of t.users) {
      console.log(`  ${u.role}: ${u.username} (${u.email}) / ${PASSWORD_PLAIN}`);
    }
    console.log();
  }

  console.log("--- Tenant configs ---");
  await seedTenantConfigs();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
