import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import prisma from "../lib/prisma.js";
import { app } from "../app.js";
import { seedTenants, storeLoginAs, bearerFor } from "./helpers.js";
import { hashPassword } from "../helpers/password.js";

let acme;
let shopco;

beforeAll(async () => {
  ({ acme, shopco } = await seedTenants());
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("storefront public routes (no auth)", () => {
  it("GET /store/products sin slug → 400 TENANT_REQUIRED", async () => {
    const res = await request(app).get("/store/products");
    expect(res.status).toBe(400);
  });

  it("GET /store/products con slug válido → 200", async () => {
    const res = await request(app)
      .get("/store/products")
      .set("X-Tenant-Slug", "acme");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /store/products con slug inexistente → 404", async () => {
    const res = await request(app)
      .get("/store/products")
      .set("X-Tenant-Slug", "noexiste");
    expect(res.status).toBe(404);
  });

  it("GET /store/categories con slug → 200", async () => {
    const res = await request(app)
      .get("/store/categories")
      .set("X-Tenant-Slug", "acme");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /store/products devuelve solo productos del tenant", async () => {
    const acmeRes = await request(app)
      .get("/store/products")
      .set("X-Tenant-Slug", "acme");
    const shopcoRes = await request(app)
      .get("/store/products")
      .set("X-Tenant-Slug", "shopco");

    const acmeNames = acmeRes.body.map((p) => p.name);
    const shopcoNames = shopcoRes.body.map((p) => p.name);

    expect(acmeNames).toContain("Remera básica");
    expect(acmeNames).not.toContain("Auriculares BT");
    expect(shopcoNames).toContain("Auriculares BT");
    expect(shopcoNames).not.toContain("Remera básica");
  });
});

describe("storefront customer auth", () => {
  it("POST /store/auth/register crea customer", async () => {
    const res = await request(app)
      .post("/store/auth/register")
      .set("X-Tenant-Slug", "acme")
      .send({
        username: "nuevo_cliente",
        email: "nuevo@test.com",
        password: "secret123",
      });

    expect(res.status).toBe(201);
    expect(res.body.usuario.role).toBe("CUSTOMER");
  });

  it("POST /store/auth/register email duplicado en mismo tenant → 409", async () => {
    const res = await request(app)
      .post("/store/auth/register")
      .set("X-Tenant-Slug", "acme")
      .send({
        username: "otro_nuevo",
        email: "customer@acme.com",
        password: "secret123",
      });

    expect(res.status).toBe(409);
  });

  it("POST /store/auth/register mismo email en otro tenant → 201", async () => {
    const res = await request(app)
      .post("/store/auth/register")
      .set("X-Tenant-Slug", "shopco")
      .send({
        username: "nuevo_cliente",
        email: "nuevo@test.com",
        password: "secret123",
      });

    expect(res.status).toBe(201);
  });

  it("POST /store/auth/login retorna JWT en body", async () => {
    const { res, token } = await storeLoginAs(app, {
      slug: "acme",
      email: "customer@acme.com",
    });

    expect(res.status).toBe(200);
    expect(token).toBeDefined();
    expect(typeof token).toBe("string");
    expect(res.body.usuario.role).toBe("CUSTOMER");
  });

  it("POST /store/auth/login con email de otro tenant → 401", async () => {
    const res = await request(app)
      .post("/store/auth/login")
      .set("X-Tenant-Slug", "acme")
      .send({ email: "customer@shopco.com", password: "password123" });

    expect(res.status).toBe(401);
  });

  it("GET /store/auth/me con Bearer token → 200", async () => {
    const customer = acme.users.find((u) => u.role === "CUSTOMER");
    const bearer = bearerFor(customer);

    const res = await request(app)
      .get("/store/auth/me")
      .set("X-Tenant-Slug", "acme")
      .set("Authorization", bearer);

    expect(res.status).toBe(200);
    expect(res.body.usuario.username).toBe("customer_acme");
  });

  it("Bearer token de tenant A en storefront de tenant B → 403", async () => {
    const customer = acme.users.find((u) => u.role === "CUSTOMER");
    const bearer = bearerFor(customer);

    const res = await request(app)
      .get("/store/auth/me")
      .set("X-Tenant-Slug", "shopco")
      .set("Authorization", bearer);

    expect(res.status).toBe(403);
  });
});

describe("storefront cart and orders (authenticated)", () => {
  let bearer;
  let productId;
  let variantId;

  beforeAll(() => {
    const customer = acme.users.find((u) => u.role === "CUSTOMER");
    bearer = bearerFor(customer);
    productId = acme.categories[0].products[0].id;
    variantId = acme.categories[0].products[0].variants[0].id;
  });

  it("POST /store/cart/:productId → 201", async () => {
    const res = await request(app)
      .post(`/store/cart/${productId}`)
      .set("X-Tenant-Slug", "acme")
      .set("Authorization", bearer)
      .send({ variantId });

    expect(res.status).toBe(201);
  });

  it("GET /store/cart → 200 con items", async () => {
    const res = await request(app)
      .get("/store/cart")
      .set("X-Tenant-Slug", "acme")
      .set("Authorization", bearer);

    expect(res.status).toBe(200);
    expect(res.body.products.length).toBeGreaterThan(0);
  });

  it("POST /store/orders → 201 crea orden", async () => {
    const res = await request(app)
      .post("/store/orders")
      .set("X-Tenant-Slug", "acme")
      .set("Authorization", bearer)
      .send({ fulfillmentMethod: "PICKUP", paymentMethod: "CASH" });

    expect(res.status).toBe(201);
    expect(res.body.order.status).toBe("PENDING");
  });

  it("GET /store/orders → 200 lista órdenes", async () => {
    const res = await request(app)
      .get("/store/orders")
      .set("X-Tenant-Slug", "acme")
      .set("Authorization", bearer);

    expect(res.status).toBe(200);
    expect(res.body.orders.length).toBeGreaterThan(0);
  });

  it("puede acceder al carrito sin auth (guest) → 200", async () => {
    const res = await request(app)
      .get("/store/cart")
      .set("X-Tenant-Slug", "acme");

    expect(res.status).toBe(200);
  });
});

describe("storefront guest cart (no auth)", () => {
  let productId;
  let variantId;

  beforeAll(() => {
    productId = shopco.categories[0].products[0].id;
    variantId = shopco.categories[0].products[0].variants[0].id;
  });

  it("GET /store/cart sin auth → 200 carrito vacío", async () => {
    const res = await request(app).get("/store/cart").set("X-Tenant-Slug", "shopco");

    expect(res.status).toBe(200);
    expect(res.body.products).toEqual([]);
  });

  it("POST /store/cart/:productId sin auth → 201 y persiste vía cookie de guest", async () => {
    const agent = request.agent(app);

    const addRes = await agent
      .post(`/store/cart/${productId}`)
      .set("X-Tenant-Slug", "shopco")
      .send({ variantId });

    expect(addRes.status).toBe(201);
    expect(
      addRes.headers["set-cookie"]?.some((c) => c.startsWith("guest_cart_id="))
    ).toBe(true);

    const getRes = await agent.get("/store/cart").set("X-Tenant-Slug", "shopco");

    expect(getRes.status).toBe(200);
    expect(getRes.body.products).toHaveLength(1);
  });

  it("el carrito de invitado se fusiona con el del user al hacer login", async () => {
    const agent = request.agent(app);

    const addRes = await agent
      .post(`/store/cart/${productId}`)
      .set("X-Tenant-Slug", "shopco")
      .send({ variantId });
    expect(addRes.status).toBe(201);

    const mergeUser = await prisma.user.create({
      data: {
        tenantId: shopco.id,
        username: "guest_merge_user",
        email: "guest.merge@shopco.com",
        password: await hashPassword("password123"),
        role: "CUSTOMER",
        emailVerified: true,
      },
    });

    const loginRes = await agent
      .post("/store/auth/login")
      .set("X-Tenant-Slug", "shopco")
      .send({ email: mergeUser.email, password: "password123" });

    expect(loginRes.status).toBe(200);
    expect(
      loginRes.headers["set-cookie"]?.some((c) => c.startsWith("guest_cart_id=;"))
    ).toBe(true);

    const cartRes = await request(app)
      .get("/store/cart")
      .set("X-Tenant-Slug", "shopco")
      .set("Authorization", `Bearer ${loginRes.body.token}`);

    expect(cartRes.status).toBe(200);
    expect(cartRes.body.products).toHaveLength(1);
  });
});
