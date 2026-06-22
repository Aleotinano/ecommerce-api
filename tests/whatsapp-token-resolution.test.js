import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { randomBytes } from "node:crypto";

// Env antes de importar config/resolver: clave de cifrado + token global de env
// (el fallback que esperamos cuando el tenant no tiene token propio).
const ENV_TOKEN = "TOKEN_GLOBAL_DE_ENV";
process.env.WHATSAPP_TOKEN_ENC_KEY = randomBytes(32).toString("hex");
process.env.WHATSAPP_ACCESS_TOKEN = ENV_TOKEN;

// Mock de prisma: solo nos interesa tenantConfig.findUnique.
const { findUniqueMock } = vi.hoisted(() => ({ findUniqueMock: vi.fn() }));
vi.mock("../lib/prisma.js", () => ({
  default: { tenantConfig: { findUnique: findUniqueMock } },
}));

const { encryptSecret } = await import("../lib/crypto.js");
const { resolveTenantByPhoneNumberId } = await import(
  "../services/whatsapp/tenant-resolver.js"
);

beforeEach(() => {
  findUniqueMock.mockReset();
});

describe("resolveTenantByPhoneNumberId - token", () => {
  it("devuelve el token de la marca descifrado", async () => {
    const brandToken = "TOKEN_DE_LA_MARCA";
    findUniqueMock.mockResolvedValue({
      tenantId: 7,
      whatsappAccessToken: encryptSecret(brandToken),
      tenant: { isActive: true },
    });

    const res = await resolveTenantByPhoneNumberId("111222333");
    expect(res).toEqual({ tenantId: 7, accessToken: brandToken });
  });

  it("cae al token de env cuando el tenant no tiene token propio", async () => {
    findUniqueMock.mockResolvedValue({
      tenantId: 7,
      whatsappAccessToken: null,
      tenant: { isActive: true },
    });

    const res = await resolveTenantByPhoneNumberId("111222333");
    expect(res).toEqual({ tenantId: 7, accessToken: ENV_TOKEN });
  });

  it("cae al token de env si el dato cifrado esta corrupto", async () => {
    findUniqueMock.mockResolvedValue({
      tenantId: 7,
      whatsappAccessToken: "dato:corrupto:noredescifrable",
      tenant: { isActive: true },
    });

    const res = await resolveTenantByPhoneNumberId("111222333");
    expect(res.accessToken).toBe(ENV_TOKEN);
  });

  it("devuelve null si no hay match o el tenant esta inactivo", async () => {
    findUniqueMock.mockResolvedValue(null);
    expect(await resolveTenantByPhoneNumberId("999")).toBeNull();

    findUniqueMock.mockResolvedValue({
      tenantId: 7,
      whatsappAccessToken: null,
      tenant: { isActive: false },
    });
    expect(await resolveTenantByPhoneNumberId("111222333")).toBeNull();
  });

  it("devuelve null sin phoneNumberId (no toca la DB)", async () => {
    expect(await resolveTenantByPhoneNumberId("")).toBeNull();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });
});
