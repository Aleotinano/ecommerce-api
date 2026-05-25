import "dotenv/config";

import prisma from "../lib/prisma.js";
import { hashPassword } from "../helpers/password.js";

const PASSWORD_PLAIN = "password123";

async function seedTenant({ slug, name, adminUsername, adminEmail, categories }) {
  const hashed = await hashPassword(PASSWORD_PLAIN);

  const tenant = await prisma.tenant.create({
    data: {
      slug,
      name,
      users: {
        create: {
          username: adminUsername,
          email: adminEmail,
          password: hashed,
          role: "ADMIN",
          emailVerified: true,
        },
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
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.product.deleteMany();
  await prisma.categories.deleteMany();
  await prisma.user.deleteMany();
  await prisma.tenant.deleteMany();

  const acme = await seedTenant({
    slug: "acme",
    name: "Acme Store",
    adminUsername: "admin_acme",
    adminEmail: "admin@acme.com",
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
  console.log(`Tenant 1: ${acme.name} (slug: ${acme.slug}, id: ${acme.id})`);
  console.log(`  Admin: ${acme.users[0].username} / ${PASSWORD_PLAIN}\n`);
  console.log(`Tenant 2: ${shopco.name} (slug: ${shopco.slug}, id: ${shopco.id})`);
  console.log(`  Admin: ${shopco.users[0].username} / ${PASSWORD_PLAIN}\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
