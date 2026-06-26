import { describe, it, expect, beforeEach, vi } from "vitest";

// Provider de texto mockeado: controlamos las etapas vision/disenador sin red.
const { generateMock } = vi.hoisted(() => ({ generateMock: vi.fn() }));
vi.mock("../lib/llm/providers/gemini.js", () => ({
  geminiProvider: { model: "test-model", generate: generateMock },
}));

const { buildImagePrompt, composeImagePrompt } = await import(
  "../lib/llm/image-prompt.js"
);

const product = {
  name: "Remera oversize",
  description: "algodon pesado, corte holgado",
  price: 12000,
  category: { name: "Remeras" },
};
const config = {
  storeName: "Acme",
  storeTagline: "ropa con onda",
  storeDescription: "marca urbana de Buenos Aires",
};

describe("buildImagePrompt (deterministico)", () => {
  it("incluye producto, marca y tono del angulo", () => {
    const out = buildImagePrompt({ product, angle: "BEST_SELLER", config });
    expect(out).toContain("Remera oversize");
    expect(out).toContain('"Acme"');
    expect(out).toContain("aspiracional");
  });

  it("nunca pide texto dentro de la imagen", () => {
    const out = buildImagePrompt({ product, angle: "NEW_ARRIVAL", config });
    expect(out).toMatch(/NO escribas ningun texto/i);
  });

  it("reserva espacio para overlay solo si hay info/precio en pantalla", () => {
    const withOverlay = buildImagePrompt({
      product,
      angle: "LOW_STOCK",
      config,
      options: { precioEnPantalla: true },
    });
    const plain = buildImagePrompt({
      product,
      angle: "LOW_STOCK",
      config,
      options: {},
    });
    expect(withOverlay).toMatch(/area amplia y despejada/i);
    expect(plain).not.toMatch(/area amplia y despejada/i);
  });

  it("tolera config y precio ausentes", () => {
    const out = buildImagePrompt({
      product: { name: "Buzo" },
      angle: "NO_RECENT_SALES",
    });
    expect(out).toContain("Buzo");
    expect(out).toContain("la tienda");
  });

  it("es puro: misma entrada, misma salida", () => {
    const a = buildImagePrompt({ product, angle: "BEST_SELLER", config });
    const b = buildImagePrompt({ product, angle: "BEST_SELLER", config });
    expect(a).toBe(b);
  });
});

describe("composeImagePrompt (pipeline best-effort)", () => {
  beforeEach(() => {
    generateMock.mockReset();
  });

  it("compone con vision + disenador y devuelve el prompt final", async () => {
    generateMock
      .mockResolvedValueOnce("una remera negra oversize de algodon") // vision
      .mockResolvedValueOnce("foto epica de la remera en un loft"); // disenador

    const out = await composeImagePrompt({
      product,
      angle: "BEST_SELLER",
      config,
      options: {},
      referenceImage: { data: "b64", mimeType: "image/png" },
    });

    expect(out.prompt).toBe("foto epica de la remera en un loft");
    expect(out.model).toBe("test-model");
    expect(out.description).toContain("remera negra");
    expect(generateMock).toHaveBeenCalledTimes(2);
    // Etapa 1 (vision) lleva imagen; etapa 3 (disenador) es texto puro.
    expect(generateMock.mock.calls[0][0].images).toBeTruthy();
    expect(generateMock.mock.calls[1][0].images).toBeFalsy();
  });

  it("si la vision falla, igual disena (sin descripcion)", async () => {
    generateMock
      .mockRejectedValueOnce(new Error("vision down"))
      .mockResolvedValueOnce("prompt disenado sin vision");

    const out = await composeImagePrompt({
      product,
      angle: "BEST_SELLER",
      config,
      options: {},
      referenceImage: { data: "b64", mimeType: "image/png" },
    });

    expect(out.prompt).toBe("prompt disenado sin vision");
    expect(out.description).toBeNull();
  });

  it("si el disenador falla, degrada al builder deterministico", async () => {
    generateMock
      .mockResolvedValueOnce("desc") // vision
      .mockRejectedValueOnce(new Error("designer down")); // disenador

    const out = await composeImagePrompt({
      product,
      angle: "BEST_SELLER",
      config,
      options: {},
      referenceImage: { data: "b64", mimeType: "image/png" },
    });

    expect(out.model).toBeNull();
    expect(out.prompt).toBe(out.base);
    expect(out.prompt).toContain("Remera oversize");
  });

  it("sin imagen de referencia salta la vision (solo disena)", async () => {
    generateMock.mockResolvedValueOnce("prompt sin referencia");

    const out = await composeImagePrompt({
      product,
      angle: "BEST_SELLER",
      config,
      options: {},
      referenceImage: undefined,
    });

    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(out.prompt).toBe("prompt sin referencia");
  });
});
