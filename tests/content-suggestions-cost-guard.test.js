import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock del cliente Redis: controlamos su disponibilidad/respuestas por test.
const { getRedisMock } = vi.hoisted(() => ({ getRedisMock: vi.fn() }));
vi.mock("../lib/redis.js", () => ({ getRedis: getRedisMock }));

const { consumeLlmQuota, DAILY_LLM_LIMIT } = await import(
  "../services/content-suggestions/cost-guard.js"
);

const fakeRedis = (overrides = {}) => ({
  incr: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  ...overrides,
});

// A diferencia del cost-guard de chat (que degrada CERRADO con 503), el de
// content-suggestions degrada ABIERTO: si Redis no esta, la feature sigue.
describe("content-suggestions cost-guard — DEGRADA ABIERTO", () => {
  beforeEach(() => {
    getRedisMock.mockReset();
  });

  it("sin Redis disponible → no limita (resuelve sin error)", async () => {
    getRedisMock.mockReturnValue(null);

    await expect(consumeLlmQuota({ tenantId: 1 })).resolves.toBeUndefined();
  });

  it("error de Redis al verificar cuota → no limita (degrada abierto)", async () => {
    getRedisMock.mockReturnValue(
      fakeRedis({ incr: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) })
    );

    await expect(consumeLlmQuota({ tenantId: 1 })).resolves.toBeUndefined();
  });

  it("dentro del limite → resuelve y setea EXPIRE en el primer hit del dia", async () => {
    const redis = fakeRedis({ incr: vi.fn().mockResolvedValue(1) });
    getRedisMock.mockReturnValue(redis);

    await expect(consumeLlmQuota({ tenantId: 1 })).resolves.toBeUndefined();
    expect(redis.expire).toHaveBeenCalledTimes(1);
  });

  it("no vuelve a setear EXPIRE despues de la primera generacion del dia", async () => {
    const redis = fakeRedis({ incr: vi.fn().mockResolvedValue(2) });
    getRedisMock.mockReturnValue(redis);

    await consumeLlmQuota({ tenantId: 1 });
    expect(redis.expire).not.toHaveBeenCalled();
  });

  it("supera el tope diario → 429 LLM_DAILY_LIMIT", async () => {
    getRedisMock.mockReturnValue(
      fakeRedis({ incr: vi.fn().mockResolvedValue(DAILY_LLM_LIMIT + 1) })
    );

    await expect(consumeLlmQuota({ tenantId: 1 })).rejects.toMatchObject({
      code: "LLM_DAILY_LIMIT",
      statusCode: 429,
    });
  });
});
