import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import prisma from "../lib/prisma.js";
import { app } from "../app.js";
import { seedTenants, loginAs } from "./helpers.js";

let acme;
let shopco;
let acmeCookie;
let shopcoCookie;

beforeAll(async () => {
  ({ acme, shopco } = await seedTenants());
  ({ cookie: acmeCookie } = await loginAs(app, {
    slug: "acme",
    username: "admin_acme",
  }));
  ({ cookie: shopcoCookie } = await loginAs(app, {
    slug: "shopco",
    username: "admin_shopco",
  }));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("isolation cross-tenant", () => {
  it("GET /categories devuelve solo las del tenant logueado", async () => {
    const acmeRes = await request(app)
      .get("/categories")
      .set("Cookie", acmeCookie);
    const shopcoRes = await request(app)
      .get("/categories")
      .set("Cookie", shopcoCookie);

    expect(acmeRes.status).toBe(200);
    expect(shopcoRes.status).toBe(200);

    const acmeNames = acmeRes.body.map((c) => c.name);
    const shopcoNames = shopcoRes.body.map((c) => c.name);

    expect(acmeNames).toContain("Remeras");
    expect(acmeNames).not.toContain("Electrónica");
    expect(shopcoNames).toContain("Electrónica");
    expect(shopcoNames).not.toContain("Remeras");
  });

  it("acme intenta leer categoría de shopco por id → 404", async () => {
    const shopcoCategoryId = shopco.categories[0].id;

    const res = await request(app)
      .get(`/categories/${shopcoCategoryId}`)
      .set("Cookie", acmeCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("CATEGORY_NOT_FOUND");
  });

  it("acme intenta leer producto de shopco → 404", async () => {
    const shopcoProductId = shopco.categories[0].products[0].id;

    const res = await request(app)
      .get(`/products/${shopcoProductId}`)
      .set("Cookie", acmeCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PRODUCT_NOT_FOUND");
  });

  it("acme no puede agregar variante de shopco al carrito", async () => {
    const shopcoVariantId =
      shopco.categories[0].products[0].variants[0].id;

    const res = await request(app)
      .post(`/cart/${shopcoVariantId}`)
      .set("Cookie", acmeCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("VARIANT_NOT_FOUND");
  });

  it("GET sin cookie → 401 (catálogo ya no es público)", async () => {
    const res = await request(app).get("/categories");
    expect(res.status).toBe(401);
  });
});

describe("register multi-tenant", () => {
  it("permite mismo username/email en tenants distintos", async () => {
    const a = await request(app).post("/auth/register").send({
      username: "cliente1",
      password: "secret123",
      email: "c@x.com",
      tenantName: "Tienda A",
      tenantSlug: "tenant-a",
    });

    const b = await request(app).post("/auth/register").send({
      username: "cliente1",
      password: "secret123",
      email: "c@x.com",
      tenantName: "Tienda B",
      tenantSlug: "tenant-b",
    });

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
  });

  it("rechaza slug duplicado → 409", async () => {
    const res = await request(app).post("/auth/register").send({
      username: "founderx",
      password: "secret123",
      email: "fx@x.com",
      tenantName: "Acme dup",
      tenantSlug: "acme",
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("TENANT_EXISTS");
  });
});
