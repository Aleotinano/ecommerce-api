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
  ({ cookie: acmeCookie } = await loginAs(app, { email: "admin@acme.com" }));
  ({ cookie: shopcoCookie } = await loginAs(app, { email: "admin@shopco.com" }));
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

  it("acme no puede agregar producto de shopco al carrito", async () => {
    const shopcoProductId = shopco.categories[0].products[0].id;
    const shopcoVariantId = shopco.categories[0].products[0].variants[0].id;

    const res = await request(app)
      .post(`/cart/${shopcoProductId}`)
      .set("Cookie", acmeCookie)
      .send({ variantId: shopcoVariantId });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PRODUCT_NOT_FOUND");
  });

  it("GET sin cookie → 401 (catálogo ya no es público)", async () => {
    const res = await request(app).get("/categories");
    expect(res.status).toBe(401);
  });
});

describe("register multi-tenant", () => {
  it("mismo username pero distintos emails y tenants → OK", async () => {
    const a = await request(app).post("/auth/register").send({
      username: "cliente1",
      password: "secret123",
      email: "c1@x.com",
      tenantName: "Tienda A",
    });

    const b = await request(app).post("/auth/register").send({
      username: "cliente1",
      password: "secret123",
      email: "c2@x.com",
      tenantName: "Tienda B",
    });

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
  });

  it("mismo email en distinto tenant → 201 (email único por tenant)", async () => {
    const res = await request(app).post("/auth/register").send({
      username: "otro_user",
      password: "secret123",
      email: "c1@x.com",
      tenantName: "Tienda C",
    });

    expect(res.status).toBe(201);
  });

  it("tenantName que slugifica a uno existente → 409 TENANT_EXISTS", async () => {
    const res = await request(app).post("/auth/register").send({
      username: "founderx",
      password: "secret123",
      email: "fx@x.com",
      tenantName: "acme",
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("TENANT_EXISTS");
  });
});
