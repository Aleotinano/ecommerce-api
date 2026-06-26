import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

// Cloudinary mockeado (sin red): controlamos upload/destroy. La persistencia
// (SuggestionImage) se ejerce de verdad contra la DB de test.
const { uploadMock, destroyMock } = vi.hoisted(() => ({
  uploadMock: vi.fn(),
  destroyMock: vi.fn(),
}));
vi.mock("../lib/cloudinary.js", () => ({
  default: { uploader: { upload: uploadMock, destroy: destroyMock } },
}));

const prisma = (await import("../lib/prisma.js")).default;
const { persistVariants, chooseVariant, deleteVariant } = await import(
  "../services/content-suggestions/images.js"
);
const { seedTenants } = await import("./helpers.js");

let acme;
let productId;
let suggestionId;

const variant = (data) => ({ data, mimeType: "image/png" });

beforeAll(async () => {
  const tenants = await seedTenants();
  acme = tenants.acme;
  productId = acme.categories[0].products[0].id;
});

beforeEach(async () => {
  destroyMock.mockReset().mockResolvedValue({ result: "ok" });

  // upload determinista: cada llamada devuelve una URL/publicId distintos.
  let i = 0;
  uploadMock.mockReset().mockImplementation(async () => {
    i += 1;
    return { secure_url: `https://cdn/img${i}.png`, public_id: `cs/img${i}` };
  });

  // Sugerencia fresca por test (cascade limpia sus imagenes).
  await prisma.contentSuggestion.deleteMany({ where: { tenantId: acme.id } });
  const s = await prisma.contentSuggestion.create({
    data: {
      tenantId: acme.id,
      productId,
      angle: "BEST_SELLER",
      date: new Date("2026-06-25"),
    },
  });
  suggestionId = s.id;
});

describe("persistVariants", () => {
  it("sube cada variante y crea las filas con chosen=false", async () => {
    const rows = await persistVariants({
      suggestionId,
      tenantId: acme.id,
      variants: [variant("a"), variant("b"), variant("c")],
      options: { imagen: true, precioEnPantalla: true },
      model: "test-image-model",
      prompt: "un fondo lindo",
    });

    expect(rows).toHaveLength(3);
    expect(uploadMock).toHaveBeenCalledTimes(3);
    expect(rows.every((r) => r.chosen === false)).toBe(true);
    expect(rows[0].imageUrl).toMatch(/^https:\/\/cdn\/img/);
    expect(rows[0].imagePublicId).toMatch(/^cs\/img/);
    expect(rows[0].model).toBe("test-image-model");
    expect(rows[0].options).toEqual({ imagen: true, precioEnPantalla: true });
  });

  it("tolera fallos parciales de subida y guarda solo las que suben", async () => {
    uploadMock
      .mockReset()
      .mockResolvedValueOnce({ secure_url: "https://cdn/ok.png", public_id: "cs/ok" })
      .mockRejectedValueOnce(new Error("cloudinary down"))
      .mockResolvedValueOnce({ secure_url: "https://cdn/ok2.png", public_id: "cs/ok2" });

    const rows = await persistVariants({
      suggestionId,
      tenantId: acme.id,
      variants: [variant("a"), variant("b"), variant("c")],
      prompt: "p",
    });

    expect(rows).toHaveLength(2);
  });

  it("no escribe nada si fallan todas las subidas", async () => {
    uploadMock.mockReset().mockRejectedValue(new Error("down"));

    const rows = await persistVariants({
      suggestionId,
      tenantId: acme.id,
      variants: [variant("a"), variant("b")],
      prompt: "p",
    });

    expect(rows).toEqual([]);
    const count = await prisma.suggestionImage.count({ where: { suggestionId } });
    expect(count).toBe(0);
  });
});

describe("chooseVariant", () => {
  it("marca la elegida y limpia las otras (Cloudinary + DB)", async () => {
    const rows = await persistVariants({
      suggestionId,
      tenantId: acme.id,
      variants: [variant("a"), variant("b"), variant("c")],
      prompt: "p",
    });

    const chosen = await chooseVariant({
      tenantId: acme.id,
      suggestionId,
      imageId: rows[0].id,
    });

    expect(chosen.chosen).toBe(true);

    const remaining = await prisma.suggestionImage.findMany({
      where: { suggestionId },
    });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(rows[0].id);
    // Se borraron los assets de las otras 2 variantes.
    expect(destroyMock).toHaveBeenCalledTimes(2);
    expect(destroyMock).toHaveBeenCalledWith(rows[1].imagePublicId, expect.anything());
  });

  it("lanza 404 si la variante no es de la sugerencia/tenant", async () => {
    await expect(
      chooseVariant({ tenantId: acme.id, suggestionId, imageId: 999999 })
    ).rejects.toMatchObject({
      code: "SUGGESTION_IMAGE_NOT_FOUND",
      statusCode: 404,
    });
  });
});

describe("deleteVariant", () => {
  it("borra el asset y la fila", async () => {
    const rows = await persistVariants({
      suggestionId,
      tenantId: acme.id,
      variants: [variant("a")],
      prompt: "p",
    });

    await deleteVariant({ tenantId: acme.id, imageId: rows[0].id });

    expect(destroyMock).toHaveBeenCalledWith(rows[0].imagePublicId, expect.anything());
    const found = await prisma.suggestionImage.findUnique({
      where: { id: rows[0].id },
    });
    expect(found).toBeNull();
  });
});
