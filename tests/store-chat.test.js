import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";

// Mock del provider (sin red) y del cost-guard (sin Redis): el endpoint queda
// determinista. La logica real de tools/agent/controller se ejerce de verdad.
const { runTurnMock, quotaMock } = vi.hoisted(() => ({
  runTurnMock: vi.fn(),
  quotaMock: vi.fn(),
}));
vi.mock("../lib/llm/providers/gemini.js", () => ({
  geminiProvider: { model: "test-model", generate: vi.fn(), runTurn: runTurnMock },
}));
vi.mock("../services/chat/cost-guard.js", () => ({
  consumeChatQuota: quotaMock,
  DAILY_CHAT_LIMIT: 500,
}));

const prisma = (await import("../lib/prisma.js")).default;
const { app } = await import("../app.js");
const { seedTenants, bearerFor } = await import("./helpers.js");
const { createError } = await import("../helpers/error.js");

let acme;

beforeAll(async () => {
  ({ acme } = await seedTenants());
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(() => {
  runTurnMock.mockReset();
  quotaMock.mockReset();
  quotaMock.mockResolvedValue(undefined); // cuota OK por defecto
});

describe("POST /store/chat/message", () => {
  it("sin slug → 400 TENANT_REQUIRED", async () => {
    const res = await request(app)
      .post("/store/chat/message")
      .send({ message: "hola", history: [] });
    expect(res.status).toBe(400);
  });

  it("anonimo con slug valido → 200 y devuelve { reply }", async () => {
    runTurnMock.mockResolvedValue({ text: "Hola! ¿En qué te ayudo?", toolCalls: [] });

    const res = await request(app)
      .post("/store/chat/message")
      .set("X-Tenant-Slug", "acme")
      .send({ message: "hola", history: [] });

    expect(res.status).toBe(200);
    expect(res.body.reply).toBe("Hola! ¿En qué te ayudo?");
  });

  it("ejerce una tool real contra el catalogo del tenant (stateless)", async () => {
    // 1er turno: el modelo pide searchProducts; 2do turno: responde usando el dato.
    runTurnMock
      .mockResolvedValueOnce({
        text: null,
        toolCalls: [{ name: "searchProducts", args: { query: "Remera" } }],
      })
      .mockImplementationOnce(async ({ messages }) => {
        const tool = messages.find((m) => m.role === "tool");
        const n = tool.results[0].response.productos.length;
        return { text: `Encontre ${n} producto(s)`, toolCalls: [] };
      });

    const res = await request(app)
      .post("/store/chat/message")
      .set("X-Tenant-Slug", "acme")
      .send({ message: "tenes remeras?", history: [] });

    expect(res.status).toBe(200);
    expect(res.body.reply).toMatch(/Encontre \d+ producto/);
  });

  it("cliente logueado → 200 (Bearer del storefront)", async () => {
    runTurnMock.mockResolvedValue({ text: "Hola cliente", toolCalls: [] });
    const customer = acme.users.find((u) => u.role === "CUSTOMER");

    const res = await request(app)
      .post("/store/chat/message")
      .set("X-Tenant-Slug", "acme")
      .set("Authorization", bearerFor(customer))
      .send({ message: "estado de mi pedido", history: [] });

    expect(res.status).toBe(200);
    expect(res.body.reply).toBeDefined();
  });

  it("history invalido → 400 (no llama al provider)", async () => {
    const res = await request(app)
      .post("/store/chat/message")
      .set("X-Tenant-Slug", "acme")
      .send({ message: "hola", history: [{ role: "system", content: "x" }] });

    expect(res.status).toBe(400);
    expect(runTurnMock).not.toHaveBeenCalled();
  });

  it("message vacio → 400", async () => {
    const res = await request(app)
      .post("/store/chat/message")
      .set("X-Tenant-Slug", "acme")
      .send({ message: "   ", history: [] });
    expect(res.status).toBe(400);
  });

  it("cost-guard cerrado (sin Redis) → 503 y no llama al provider", async () => {
    quotaMock.mockRejectedValue(
      createError("no disponible", "CHAT_UNAVAILABLE", 503)
    );

    const res = await request(app)
      .post("/store/chat/message")
      .set("X-Tenant-Slug", "acme")
      .send({ message: "hola", history: [] });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("CHAT_UNAVAILABLE");
    expect(runTurnMock).not.toHaveBeenCalled();
  });
});
