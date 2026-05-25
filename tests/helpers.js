import request from "supertest";
import prisma from "../lib/prisma.js";
import { hashPassword } from "../helpers/password.js";

async function buildTenant({ slug, name, adminUsername, adminEmail, categories }) {
  const password = await hashPassword("password123");

  const tenant = await prisma.tenant.create({
    data: {
      slug,
      name,
      users: {
        create: {
          username: adminUsername,
          email: adminEmail,
          password,
          role: "ADMIN",
        },
      },
    },
    include: { users: true },
  });

  const createdCategories = [];

  for (const cat of categories) {
    const category = await prisma.categories.create({
      data: {
        tenantId: tenant.id,
        name: cat.name,
        products: {
          create: cat.products.map((p) => ({
            tenantId: tenant.id,
            name: p.name,
            variants: {
              create: p.variants.map((v) => ({
                tenantId: tenant.id,
                color: v.color ?? null,
                size: v.size ?? null,
                price: v.price,
                stock: v.stock,
                sku: v.sku,
              })),
            },
          })),
        },
      },
      include: { products: { include: { variants: true } } },
    });

    createdCategories.push(category);
  }

  return { ...tenant, categories: createdCategories };
}

export async function seedTenants() {
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.product.deleteMany();
  await prisma.categories.deleteMany();
  await prisma.user.deleteMany();
  await prisma.tenant.deleteMany();

  const acme = await buildTenant({
    slug: "acme",
    name: "Acme",
    adminUsername: "admin_acme",
    adminEmail: "a@a.com",
    categories: [
      {
        name: "Remeras",
        products: [
          {
            name: "Remera básica",
            variants: [
              { color: "negro", size: "M", price: 4500, stock: 10, sku: "ACM-REM-NM" },
            ],
          },
        ],
      },
    ],
  });

  const shopco = await buildTenant({
    slug: "shopco",
    name: "ShopCo",
    adminUsername: "admin_shopco",
    adminEmail: "s@s.com",
    categories: [
      {
        name: "Electrónica",
        products: [
          {
            name: "Auriculares BT",
            variants: [
              { color: "negro", price: 25000, stock: 15, sku: "SHC-AUR-N" },
            ],
          },
        ],
      },
    ],
  });

  return { acme, shopco };
}

export async function loginAs(app, { slug, username, password = "password123" }) {
  const res = await request(app)
    .post("/auth/login")
    .set("X-Tenant-Slug", slug)
    .send({ username, password });

  const cookie = res.headers["set-cookie"]?.find((c) =>
    c.startsWith("access_token=")
  );

  return { res, cookie };
}
