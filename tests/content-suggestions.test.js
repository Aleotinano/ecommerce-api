import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";

// Provider mockeado (sin red) y cost-guard mockeado (sin Redis): el copy queda
// determinista. La seleccion (Fase 1), el controller y la persistencia se ejercen
// de verdad contra la DB de test.
const { generateMock, quotaMock } = vi.hoisted(() => ({
  generateMock: vi.fn(),
  quotaMock: vi.fn(),
}));
vi.mock("../lib/llm/providers/gemini.js", () => ({
  geminiProvider: { model: "test-model", generate: generateMock },
}));
vi.mock("../services/content-suggestions/cost-guard.js", () => ({
  consumeLlmQuota: quotaMock,
  DAILY_LLM_LIMIT: 15,
}));

const prisma = (await import("../lib/prisma.js")).default;
const { app } = await import("../app.js");
const { seedTenants, seedTenantConfig, cookieFor } = await import("./helpers.js");

let acme;
let shopco;
let adminCookie;
let customerCookie;
let productId;
let lowStockId;

const llmReply = (copy, hashtags) =>
  JSON.stringify({ copy, hashtags });

beforeAll(async () => {
  const tenants = await seedTenants();
  acme = tenants.acme;
  shopco = tenants.shopco;
  await seedTenantConfig(acme.id);

  // acme: ADMIN en users[0], CUSTOMER en users[1] (ver helpers).
  adminCookie = cookieFor(acme.users[0]);
  customerCookie = cookieFor(acme.users.find((u) => u.role === "CUSTOMER"));

  // Producto recien creado, stock 10, sin ventas => aplican NEW_ARRIVAL y
  // NO_RECENT_SALES (no BEST_SELLER ni LOW_STOCK).
  productId = acme.categories[0].products[0].id;

  // Producto VIEJO (fuera de la ventana de novedades) con stock bajo y sin
  // ventas => aplican LOW_STOCK y NO_RECENT_SALES, pero NO NEW_ARRIVAL. Asi la
  // seleccion AUTO (que arranca en NEW_ARRIVAL) sigue eligiendo "Remera básica"
  // y los angulos de generacion manual no colisionan con la fila AUTO del dia.
  const lowStock = await prisma.product.create({
    data: {
      tenantId: acme.id,
      name: "Stock bajo",
      price: 1000,
      categoryId: acme.categories[0].id,
      createdAt: new Date("2026-04-01T00:00:00.000Z"),
      variants: {
        create: [
          {
            tenantId: acme.id,
            stock: 3,
            price: 1000,
            sku: "ACM-LOW-1",
            isActive: true,
          },
        ],
      },
    },
  });
  lowStockId = lowStock.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(() => {
  generateMock.mockReset();
  generateMock.mockResolvedValue(llmReply("Copy de prueba", ["#test"]));
  quotaMock.mockReset();
  quotaMock.mockResolvedValue(undefined); // cuota OK por defecto
});

describe("Autorizacion", () => {
  it("sin sesion → 401", async () => {
    const res = await request(app).get("/content-suggestions/today");
    expect(res.status).toBe(401);
  });

  it("rol CUSTOMER → 403", async () => {
    const res = await request(app)
      .get("/content-suggestions/today")
      .set("Cookie", customerCookie);
    expect(res.status).toBe(403);
  });
});

describe("GET /content-suggestions/today", () => {
  it("crea on-demand la sugerencia del dia y la persiste como AUTO", async () => {
    const res = await request(app)
      .get("/content-suggestions/today")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.suggestion).toBeTruthy();
    expect(res.body.suggestion.source).toBe("AUTO");
    expect(res.body.suggestion.copy).toBe("Copy de prueba");
    expect(res.body.suggestion.product.name).toBe("Remera básica");

    const row = await prisma.contentSuggestion.findFirst({
      where: { tenantId: acme.id, source: "AUTO" },
    });
    expect(row).toBeTruthy();
  });
});

describe("GET /content-suggestions/products/:productId/angles", () => {
  it("devuelve solo los angulos que aplican al producto", async () => {
    const res = await request(app)
      .get(`/content-suggestions/products/${productId}/angles`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.angles).toEqual(["NEW_ARRIVAL", "NO_RECENT_SALES"]);
  });

  it("producto de otro tenant → 404 PRODUCT_NOT_FOUND", async () => {
    const otherId = shopco.categories[0].products[0].id;
    const res = await request(app)
      .get(`/content-suggestions/products/${otherId}/angles`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PRODUCT_NOT_FOUND");
  });
});

describe("POST /content-suggestions/products/:productId/generate", () => {
  it("genera y persiste el copy (source MANUAL) para un angulo aplicable", async () => {
    const res = await request(app)
      .post(`/content-suggestions/products/${lowStockId}/generate`)
      .set("Cookie", adminCookie)
      .send({ angle: "LOW_STOCK" });

    expect(res.status).toBe(200);
    expect(res.body.suggestion.source).toBe("MANUAL");
    expect(res.body.suggestion.angle).toBe("LOW_STOCK");
    expect(res.body.suggestion.model).toBe("test-model");
    expect(quotaMock).toHaveBeenCalledOnce();
  });

  it("angulo que no aplica → 422 ANGLE_NOT_APPLICABLE (no consume cuota)", async () => {
    const res = await request(app)
      .post(`/content-suggestions/products/${productId}/generate`)
      .set("Cookie", adminCookie)
      .send({ angle: "BEST_SELLER" });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("ANGLE_NOT_APPLICABLE");
    expect(quotaMock).not.toHaveBeenCalled();
  });

  it("angulo invalido (fuera del enum) → 400", async () => {
    const res = await request(app)
      .post(`/content-suggestions/products/${productId}/generate`)
      .set("Cookie", adminCookie)
      .send({ angle: "NOPE" });

    expect(res.status).toBe(400);
  });

  it("tope diario alcanzado → 429 LLM_DAILY_LIMIT", async () => {
    const { createError } = await import("../helpers/error.js");
    quotaMock.mockRejectedValue(
      createError("limite", "LLM_DAILY_LIMIT", 429)
    );

    const res = await request(app)
      .post(`/content-suggestions/products/${lowStockId}/generate`)
      .set("Cookie", adminCookie)
      .send({ angle: "NO_RECENT_SALES" });

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("LLM_DAILY_LIMIT");
  });
});

describe("POST /content-suggestions/refine", () => {
  it("devuelve una variacion SIN persistir", async () => {
    generateMock.mockResolvedValue(llmReply("Version mas corta", ["#corto"]));

    const before = await prisma.contentSuggestion.count({
      where: { tenantId: acme.id },
    });

    const res = await request(app)
      .post("/content-suggestions/refine")
      .set("Cookie", adminCookie)
      .send({
        productId,
        angle: "NEW_ARRIVAL",
        mode: "shorter",
        baseCopy: "Un copy bastante largo para acortar",
        baseHashtags: ["#largo"],
      });

    expect(res.status).toBe(200);
    expect(res.body.variation.copy).toBe("Version mas corta");

    const after = await prisma.contentSuggestion.count({
      where: { tenantId: acme.id },
    });
    expect(after).toBe(before); // no persiste
  });

  it("modo custom sin instruccion → 400", async () => {
    const res = await request(app)
      .post("/content-suggestions/refine")
      .set("Cookie", adminCookie)
      .send({
        productId,
        angle: "NEW_ARRIVAL",
        mode: "custom",
        baseCopy: "Copy base",
      });

    expect(res.status).toBe(400);
  });
});

describe("GET /content-suggestions (timeline)", () => {
  it("devuelve el rango completo con dias vacios en null", async () => {
    const res = await request(app)
      .get("/content-suggestions?range=7")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.range).toBe(7);
    expect(res.body.days).toHaveLength(7);
    // El ultimo dia (hoy) tiene la sugerencia AUTO creada antes.
    const today = res.body.days.at(-1);
    expect(today.hasSuggestion).toBe(true);
    expect(today.suggestion).toBeTruthy();
  });

  it("range invalido → 400", async () => {
    const res = await request(app)
      .get("/content-suggestions?range=99")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(400);
  });
});
