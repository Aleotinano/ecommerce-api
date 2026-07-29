import request from "supertest";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.js";
import { hashPassword } from "../helpers/password.js";
import { DEFAULTS } from "../config.js";

export function cookieFor(user) {
  const token = jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      email: user.email,
      tenantId: user.tenantId,
    },
    DEFAULTS.SECRET_JWT_KEY,
    { expiresIn: "1h" }
  );
  return `access_token=${token}`;
}

async function buildTenant({ slug, name, adminUsername, adminEmail, customerUsername, customerEmail, categories }) {
  const password = await hashPassword("password123");

  const users = [
    {
      username: adminUsername,
      email: adminEmail,
      password,
      role: "ADMIN",
      emailVerified: true,
    },
  ];

  if (customerUsername) {
    users.push({
      username: customerUsername,
      email: customerEmail,
      password,
      role: "CUSTOMER",
      emailVerified: true,
      // Los tenants nacen con `customerPhoneMode: "required"`, así que un
      // cliente sin teléfono no puede completar un checkout. Los clientes de
      // fixture traen uno para que los tests de carrito/pago/entrega sigan
      // probando lo suyo; la política del teléfono se prueba aparte, en
      // tests/orders-contact-phone.test.js.
      phone: "5491155550000",
    });
  }

  const tenant = await prisma.tenant.create({
    data: {
      slug,
      name,
      users: { create: users },
      // Catálogo de atributos de variante del tenant (seteo one-time). TEXT para
      // que los fixtures puedan usar valores legibles ("negro") sin regla HEX.
      attributes: {
        create: [
          { key: "color", label: "Color", type: "TEXT", position: 0 },
          { key: "talle", label: "Talle", type: "TEXT", position: 1 },
        ],
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
            type: "PRODUCTO",
            variants: {
              create: p.variants.map((v, index) => ({
                tenantId: tenant.id,
                attributes: v.attributes ?? {},
                price: v.price,
                stock: v.stock,
                sku: v.sku,
                isDefault: index === 0,
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
  // ContentSuggestion referencia Product con FK RESTRICT: hay que limpiarla antes
  // de borrar productos o el reseed falla.
  await prisma.contentSuggestion.deleteMany();
  // Caja antes que Tenant: `deleteMany` no dispara el ON DELETE CASCADE de la FK
  // (mismo motivo que UserAddress más abajo), y los movimientos además referencian
  // etiquetas con FK Restrict, que ni con cascade se irían.
  await prisma.cashMovement.deleteMany();
  await prisma.cashRegisterSession.deleteMany();
  await prisma.cashCategory.deleteMany();
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.product.deleteMany();
  await prisma.categories.deleteMany();
  await prisma.tenantAttribute.deleteMany();
  await prisma.tenantConfig.deleteMany();
  // Antes que User: `deleteMany` de Prisma no dispara el ON DELETE CASCADE de la
  // FK, así que las direcciones huérfanas romperían el reseed de TODOS los tests.
  await prisma.userAddress.deleteMany();
  await prisma.user.deleteMany();
  await prisma.tenant.deleteMany();

  const acme = await buildTenant({
    slug: "acme",
    name: "Acme",
    adminUsername: "admin_acme",
    adminEmail: "admin@acme.com",
    customerUsername: "customer_acme",
    customerEmail: "customer@acme.com",
    categories: [
      {
        name: "Remeras",
        products: [
          {
            name: "Remera básica",
            variants: [
              { attributes: { color: "negro", talle: "M" }, price: 4500, stock: 10, sku: "ACM-REM-NM" },
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
    adminEmail: "admin@shopco.com",
    customerUsername: "customer_shopco",
    customerEmail: "customer@shopco.com",
    categories: [
      {
        name: "Electrónica",
        products: [
          {
            name: "Auriculares BT",
            variants: [
              { attributes: { color: "negro" }, price: 25000, stock: 15, sku: "SHC-AUR-N" },
            ],
          },
        ],
      },
    ],
  });

  return { acme, shopco };
}

export async function seedTenantConfig(tenantId, overrides = {}) {
  return prisma.tenantConfig.upsert({
    where: { tenantId },
    update: { ...overrides },
    create: {
      tenantId,
      storeName: "Acme Store",
      storeDescription: "Tienda demo de Acme",
      storeTagline: "Lo mejor en remeras",
      contactEmail: "contacto@acme.com",
      contactPhone: "+541112345678",
      contactAddress: "Av. Siempre Viva 123",
      socialInstagram: "https://instagram.com/acme",
      currency: "ARS",
      locale: "es-AR",
      showOutOfStock: false,
      allowCartGuest: true,
      ...overrides,
    },
  });
}

export function bearerFor(user) {
  const token = jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      email: user.email,
      tenantId: user.tenantId,
    },
    DEFAULTS.SECRET_JWT_KEY,
    { expiresIn: "1h" }
  );
  return `Bearer ${token}`;
}

export async function loginAs(app, { email, password = "password123" }) {
  const res = await request(app)
    .post("/auth/login")
    .send({ email, password });

  const cookie = res.headers["set-cookie"]?.find((c) =>
    c.startsWith("access_token=")
  );

  return { res, cookie };
}

export async function storeLoginAs(app, { slug, email, password = "password123" }) {
  const res = await request(app)
    .post("/store/auth/login")
    .set("X-Tenant-Slug", slug)
    .send({ email, password });

  return { res, token: res.body.token };
}
