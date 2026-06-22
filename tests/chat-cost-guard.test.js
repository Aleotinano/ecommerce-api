import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock del cliente Redis: controlamos su disponibilidad/respuestas por test.
const { getRedisMock } = vi.hoisted(() => ({ getRedisMock: vi.fn() }));
vi.mock("../lib/redis.js", () => ({ getRedis: getRedisMock }));

const { consumeChatQuota, DAILY_CHAT_LIMIT } = await import(
  "../services/chat/cost-guard.js"
);

const fakeRedis = (overrides = {}) => ({
  incr: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  ...overrides,
});

describe("chat cost-guard — DEGRADA CERRADO", () => {
  beforeEach(() => {
    getRedisMock.mockReset();
  });

  it("sin Redis disponible → 503 CHAT_UNAVAILABLE (no llama al LLM)", async () => {
    getRedisMock.mockReturnValue(null);

    await expect(consumeChatQuota({ tenantId: 1 })).rejects.toMatchObject({
      code: "CHAT_UNAVAILABLE",
      statusCode: 503,
    });
  });

  it("error de Redis al verificar cuota → 503 CHAT_UNAVAILABLE", async () => {
    getRedisMock.mockReturnValue(
      fakeRedis({ incr: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) })
    );

    await expect(consumeChatQuota({ tenantId: 1 })).rejects.toMatchObject({
      code: "CHAT_UNAVAILABLE",
      statusCode: 503,
    });
  });

  it("dentro del limite → resuelve sin error y setea EXPIRE en el primer hit", async () => {
    const redis = fakeRedis({ incr: vi.fn().mockResolvedValue(1) });
    getRedisMock.mockReturnValue(redis);

    await expect(consumeChatQuota({ tenantId: 1 })).resolves.toBeUndefined();
    expect(redis.expire).toHaveBeenCalledTimes(1);
  });

  it("no vuelve a setear EXPIRE despues del primer mensaje del dia", async () => {
    const redis = fakeRedis({ incr: vi.fn().mockResolvedValue(2) });
    getRedisMock.mockReturnValue(redis);

    await consumeChatQuota({ tenantId: 1 });
    expect(redis.expire).not.toHaveBeenCalled();
  });

  it("supera el tope diario → 429 CHAT_DAILY_LIMIT", async () => {
    getRedisMock.mockReturnValue(
      fakeRedis({ incr: vi.fn().mockResolvedValue(DAILY_CHAT_LIMIT + 1) })
    );

    await expect(consumeChatQuota({ tenantId: 1 })).rejects.toMatchObject({
      code: "CHAT_DAILY_LIMIT",
      statusCode: 429,
    });
  });
});
