import { describe, it, expect, beforeEach, vi } from "vitest";

const { uploadMock, destroyMock, signMock } = vi.hoisted(() => ({
  uploadMock: vi.fn(),
  destroyMock: vi.fn(),
  signMock: vi.fn(),
}));
vi.mock("../lib/cloudinary.js", () => ({
  default: {
    uploader: { upload: uploadMock, destroy: destroyMock },
    utils: { private_download_url: signMock },
  },
}));

// El puerto borra el temporal después de subir; en este test no hay archivo real.
vi.mock("../lib/imageManager.js", async (importOriginal) => ({
  ...(await importOriginal()),
  removeLocalFile: vi.fn(),
}));

const { putFile, deleteFile, signedUrl } = await import("../lib/storage/index.js");
const { resourceTypeFor } = await import("../lib/storage/cloudinary.js");
const { DEFAULTS } = await import("../config.js");

beforeEach(() => {
  uploadMock.mockReset().mockResolvedValue({
    public_id: "carpeta/asset",
    resource_type: "image",
    type: "authenticated",
    format: "jpg",
    bytes: 999,
  });
  destroyMock.mockReset().mockResolvedValue({ result: "ok" });
  signMock.mockReset().mockReturnValue("https://firmada.test/asset");
});

describe("resourceTypeFor", () => {
  it("manda el PDF a raw y las imágenes a image", () => {
    // El PDF como `image` dependería de que la cuenta tenga habilitada la entrega
    // de PDF, que viene bloqueada por defecto en varias.
    expect(resourceTypeFor("application/pdf")).toBe("raw");
    expect(resourceTypeFor("image/jpeg")).toBe("image");
    expect(resourceTypeFor("image/webp")).toBe("image");
  });
});

describe("putFile", () => {
  it("aísla por tenant en la carpeta y sube como authenticated", async () => {
    await putFile("/tmp/x.jpg", {
      tenantId: 42,
      entity: "receipts",
      mimeType: "image/jpeg",
    });

    expect(uploadMock).toHaveBeenCalledWith(
      "/tmp/x.jpg",
      expect.objectContaining({
        // Con la carpeta ya separada por tenant, mudar un cliente a su propia
        // cuenta de Cloudinary es mover una carpeta, no filtrar fila por fila.
        folder: `${DEFAULTS.CLOUDINARY_FOLDER}/tenants/42/receipts`,
        resource_type: "image",
        type: "authenticated",
      })
    );
  });

  it("devuelve el descriptor con el proveedor incluido", async () => {
    const stored = await putFile("/tmp/x.jpg", {
      tenantId: 1,
      entity: "receipts",
      mimeType: "image/jpeg",
    });

    expect(stored).toMatchObject({
      storageProvider: "cloudinary",
      publicId: "carpeta/asset",
      resourceType: "image",
      deliveryType: "authenticated",
      format: "jpg",
      bytes: 999,
    });
  });

  it("sube público solo si se lo piden explícitamente", async () => {
    await putFile("/tmp/x.jpg", {
      tenantId: 1,
      entity: "otros",
      mimeType: "image/jpeg",
      access: "public",
    });

    expect(uploadMock).toHaveBeenCalledWith(
      "/tmp/x.jpg",
      expect.objectContaining({ type: "upload" })
    );
  });
});

describe("signedUrl", () => {
  it("pide siempre una URL con vencimiento", () => {
    const antes = Math.floor(Date.now() / 1000);

    signedUrl({
      storageProvider: "cloudinary",
      publicId: "carpeta/asset",
      resourceType: "raw",
      deliveryType: "authenticated",
      format: "pdf",
    });

    expect(signMock).toHaveBeenCalledWith(
      "carpeta/asset",
      "pdf",
      expect.objectContaining({ resource_type: "raw", type: "authenticated" })
    );

    // Sin `expires_at` el link no muere nunca, que es lo que hace peligrosa a una
    // URL de un archivo con CBU y nombre adentro.
    const [, , options] = signMock.mock.calls[0];
    expect(options.expires_at).toBeGreaterThan(antes);
  });
});

describe("deleteFile", () => {
  it("manda resource_type y type, sin los cuales el borrado es un no-op silencioso", async () => {
    await deleteFile({
      storageProvider: "cloudinary",
      publicId: "carpeta/comprobante",
      resourceType: "raw",
      deliveryType: "authenticated",
    });

    // `destroy` asume image/upload si no se los pasás: con los defaults, borrar un
    // PDF authenticated devuelve "not found" y NO falla — el archivo se queda.
    expect(destroyMock).toHaveBeenCalledWith("carpeta/comprobante", {
      resource_type: "raw",
      type: "authenticated",
      invalidate: true,
    });
  });

  it("no llama al proveedor si no hay publicId", async () => {
    await deleteFile({ storageProvider: "cloudinary", publicId: null });
    expect(destroyMock).not.toHaveBeenCalled();
  });

  it("falla fuerte con un proveedor desconocido en vez de perder el archivo", async () => {
    await expect(
      deleteFile({ storageProvider: "dropbox", publicId: "x" })
    ).rejects.toMatchObject({ code: "STORAGE_PROVIDER_UNKNOWN" });
  });
});
