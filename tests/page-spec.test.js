import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import prisma from "../lib/prisma.js";
import { app } from "../app.js";
import { seedTenants, cookieFor } from "./helpers.js";

let acme;
let shopco;
let adminCookie;

const sampleSpec = {
  theme: { mood: "demo", palette: "calido", typography: "display", density: "aireado" },
  blocks: [
    { component: "Header", props: { variant: "minimal", sticky: true, announcement: null } },
    { component: "Footer", props: { variant: "completo", showSocial: true } },
  ],
};

beforeAll(async () => {
  ({ acme, shopco } = await seedTenants());
  const admin = acme.users.find((u) => u.role === "ADMIN");
  adminCookie = cookieFor(admin);

  // Una orden COMPLETED con la variante de acme, para que aplique BEST_SELLER.
  const variant = acme.categories[0].products[0].variants[0];
  const customer = acme.users.find((u) => u.role === "CUSTOMER");
  await prisma.order.create({
    data: {
      tenantId: acme.id,
      userId: customer.id,
      status: "COMPLETED",
      total: 9000,
      paymentStatus: "PENDING",
      orderItems: {
        create: [{ productId: variant.productId, variantId: variant.id, quantity: 2, price: 4500 }],
      },
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("/page-spec admin (auth + scoping)", () => {
  it("GET /page-spec sin auth → 401", async () => {
    const res = await request(app).get("/page-spec");
    expect(res.status).toBe(401);
  });

  it("PUT /page-spec/draft guarda el borrador (admin)", async () => {
    const res = await request(app)
      .put("/page-spec/draft")
      .set("Cookie", adminCookie)
      .send({ spec: sampleSpec });
    expect(res.status).toBe(200);
    expect(res.body.spec.blocks).toHaveLength(2);
  });

  it("GET /page-spec devuelve el borrador guardado", async () => {
    const res = await request(app).get("/page-spec").set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.spec.theme.palette).toBe("calido");
  });

  it("POST /page-spec/publish promueve el borrador y sube version", async () => {
    const res = await request(app)
      .post("/page-spec/publish")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);
    expect(res.body.publishedAt).toBeTruthy();
    expect(res.body.spec.blocks).toHaveLength(2);
  });

  it("GET /store/page (público) sirve el spec publicado del tenant", async () => {
    const res = await request(app).get("/store/page").set("X-Tenant-Slug", "acme");
    expect(res.status).toBe(200);
    expect(res.body.spec.theme.palette).toBe("calido");
    expect(res.body.version).toBe(1);
  });

  it("GET /store/page de un tenant sin spec → spec null", async () => {
    const res = await request(app).get("/store/page").set("X-Tenant-Slug", "shopco");
    expect(res.status).toBe(200);
    expect(res.body.spec).toBeNull();
  });

  it("POST /page-spec/publish sin borrador → 409 NO_DRAFT_TO_PUBLISH", async () => {
    const shopcoAdmin = shopco.users.find((u) => u.role === "ADMIN");
    const res = await request(app)
      .post("/page-spec/publish")
      .set("Cookie", cookieFor(shopcoAdmin));
    expect(res.status).toBe(409);
    expect(res.body.error?.code ?? res.body.code).toBe("NO_DRAFT_TO_PUBLISH");
  });
});

describe("GET /store/products?angle= (destacados por ángulo)", () => {
  it("angle=BEST_SELLER devuelve el producto con ventas COMPLETED", async () => {
    const res = await request(app)
      .get("/store/products?angle=BEST_SELLER")
      .set("X-Tenant-Slug", "acme");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.map((p) => p.name)).toContain("Remera básica");
  });

  it("angle=LOW_STOCK con stock alto (10) → lista vacía", async () => {
    const res = await request(app)
      .get("/store/products?angle=LOW_STOCK")
      .set("X-Tenant-Slug", "acme");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it("respeta el scope por tenant: shopco no ve productos de acme", async () => {
    const res = await request(app)
      .get("/store/products?angle=BEST_SELLER")
      .set("X-Tenant-Slug", "shopco");
    expect(res.status).toBe(200);
    expect(res.body.map((p) => p.name)).not.toContain("Remera básica");
  });

  it("angle inválido → 400 (validación de schema)", async () => {
    const res = await request(app)
      .get("/store/products?angle=NOPE")
      .set("X-Tenant-Slug", "acme");
    expect(res.status).toBe(400);
  });
});
