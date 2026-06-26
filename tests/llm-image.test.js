import { describe, it, expect, beforeEach, vi } from "vitest";

// Mockeamos el provider de imagen: controlamos cada variante (resuelve o rechaza).
// fetch (la imagen de referencia) tambien se mockea: sin red, deterministico.
const { generateImageMock } = vi.hoisted(() => ({ generateImageMock: vi.fn() }));
vi.mock("../lib/llm/providers/gemini-image.js", () => ({
  geminiImageProvider: {
    model: "test-image-model",
    generateImage: generateImageMock,
  },
}));

const { generateImages } = await import("../lib/llm/image.js");

const okImage = (data = "b64") => ({ data, mimeType: "image/png" });

/** Respuesta de fetch para la imagen de referencia (200, con bytes). */
const refOk = () => ({
  ok: true,
  headers: { get: () => "image/png" },
  arrayBuffer: async () => new TextEncoder().encode("fakebytes").buffer,
});

describe("generateImages — fachada best-effort", () => {
  beforeEach(() => {
    generateImageMock.mockReset();
    global.fetch = vi.fn().mockResolvedValue(refOk());
  });

  it("devuelve N variantes y el modelo cuando todas salen", async () => {
    generateImageMock.mockResolvedValue(okImage());

    const out = await generateImages({
      referenceImageUrl: "http://cdn/img.png",
      prompt: "un fondo lindo",
      n: 3,
    });

    expect(out.images).toHaveLength(3);
    expect(out.model).toBe("test-image-model");
    expect(generateImageMock).toHaveBeenCalledTimes(3);
    // La referencia se baja UNA sola vez, no una por variante.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("degrada a { images: [], model: null } si fallan todas", async () => {
    generateImageMock.mockRejectedValue(new Error("boom"));

    const out = await generateImages({
      referenceImageUrl: "http://cdn/img.png",
      prompt: "p",
      n: 3,
    });

    expect(out).toEqual({ images: [], model: null });
  });

  it("tolera fallos parciales y devuelve solo las variantes que salieron", async () => {
    generateImageMock
      .mockResolvedValueOnce(okImage("a"))
      .mockRejectedValueOnce(new Error("x"))
      .mockRejectedValueOnce(new Error("y"));

    const out = await generateImages({
      referenceImageUrl: "http://cdn/img.png",
      prompt: "p",
      n: 3,
    });

    expect(out.images).toEqual([okImage("a")]);
    expect(out.model).toBe("test-image-model");
  });

  it("sigue como text-to-image si la referencia no se puede bajar", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    generateImageMock.mockResolvedValue(okImage());

    const out = await generateImages({
      referenceImageUrl: "http://cdn/missing.png",
      prompt: "p",
      n: 1,
    });

    expect(out.images).toHaveLength(1);
    expect(generateImageMock).toHaveBeenCalledWith({
      prompt: "p",
      referenceImage: null,
    });
  });

  it("no llama al provider si no hay prompt", async () => {
    const out = await generateImages({ referenceImageUrl: "http://cdn/img.png", n: 3 });

    expect(out).toEqual({ images: [], model: null });
    expect(generateImageMock).not.toHaveBeenCalled();
  });
});
