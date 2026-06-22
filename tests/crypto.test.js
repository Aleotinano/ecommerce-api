import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";

// Clave de 32 bytes en hex, seteada antes de importar el helper (lo lee de env).
beforeAll(() => {
  process.env.WHATSAPP_TOKEN_ENC_KEY = randomBytes(32).toString("hex");
});

const { encryptSecret, decryptSecret } = await import("../lib/crypto.js");

describe("lib/crypto", () => {
  it("hace round-trip: decrypt(encrypt(x)) === x", () => {
    const secret = "EAAG_un_token_de_whatsapp_largo_123";
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it("produce un payload distinto en cada cifrado (IV aleatorio)", () => {
    const secret = "mismo-secreto";
    const a = encryptSecret(secret);
    const b = encryptSecret(secret);
    expect(a).not.toBe(b);
    // pero ambos descifran al mismo plaintext
    expect(decryptSecret(a)).toBe(secret);
    expect(decryptSecret(b)).toBe(secret);
  });

  it("lanza al descifrar con clave equivocada", () => {
    const payload = encryptSecret("secreto");
    process.env.WHATSAPP_TOKEN_ENC_KEY = randomBytes(32).toString("hex");
    expect(() => decryptSecret(payload)).toThrow();
  });

  it("lanza si el payload tiene formato invalido", () => {
    expect(() => decryptSecret("no-tiene-tres-partes")).toThrow();
  });
});
