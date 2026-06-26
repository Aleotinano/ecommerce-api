/**
 * Fachada del cliente de imagen (image-to-image) con el proveedor desacoplado por
 * env (IMAGE_PROVIDER, default gemini). Interfaz unica:
 *   generateImages({ referenceImageUrl, prompt, n }) -> { images, model }
 * donde images es un array de { data (base64), mimeType }.
 *
 * Best-effort, igual que el cliente de texto (lib/llm/index.js): NUNCA lanza. Si
 * el provider falla, no hay API key, o ninguna variante sale, devuelve
 * { images: [], model: null } para que el caller degrade a la foto real del
 * producto (product.img) sin romper la feature.
 */
import { DEFAULTS } from "../../config.js";
import { logger } from "../logger.js";
import { geminiImageProvider } from "./providers/gemini-image.js";

const log = logger.child({ module: "llm-image" });

const PROVIDERS = {
  gemini: geminiImageProvider,
};

/** Cuantas variantes pedir por defecto (alineado con la cuota de imagen). */
const DEFAULT_VARIANTS = 3;

/**
 * Baja la imagen de referencia (la foto del producto, normalmente una URL de
 * Cloudinary) y la devuelve en base64 + mimeType para pasarla como inlineData.
 * Si falla, devuelve null: la generacion sigue como text-to-image.
 */
const fetchReferenceImage = async (referenceImageUrl) => {
  if (!referenceImageUrl) return null;
  try {
    const res = await fetch(referenceImageUrl);
    if (!res.ok) {
      throw new Error(`referencia ${res.status}`);
    }
    const mimeType = res.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await res.arrayBuffer());
    return { data: buffer.toString("base64"), mimeType };
  } catch (error) {
    log.warn(
      { err: error.message, referenceImageUrl },
      "no se pudo bajar la imagen de referencia, sigo sin ella"
    );
    return null;
  }
};

/**
 * Genera N variantes de imagen para un prompt, usando la foto del producto como
 * referencia (image-to-image). Hace N llamadas en paralelo y junta las que salen;
 * tolera fallos parciales (devuelve las variantes que si se generaron).
 *
 * @param {object} args
 * @param {string} [args.referenceImageUrl] - URL de la foto del producto.
 * @param {string} args.prompt - prompt de construccion de la imagen.
 * @param {number} [args.n=3] - cantidad de variantes a generar.
 * @returns {Promise<{ images: Array<{ data: string, mimeType: string }>, model: string|null }>}
 */
export const generateImages = async ({ referenceImageUrl, prompt, n = DEFAULT_VARIANTS }) => {
  const provider = PROVIDERS[DEFAULTS.LLM.IMAGE.PROVIDER] ?? geminiImageProvider;
  const empty = { images: [], model: null };

  if (!prompt) {
    log.warn("generateImages sin prompt, devuelvo vacio");
    return empty;
  }

  const referenceImage = await fetchReferenceImage(referenceImageUrl);

  const settled = await Promise.allSettled(
    Array.from({ length: n }, () => provider.generateImage({ prompt, referenceImage }))
  );

  const images = settled
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);

  const failed = settled.length - images.length;
  if (failed) {
    const reason = settled.find((r) => r.status === "rejected")?.reason;
    log.warn(
      { provider: DEFAULTS.LLM.IMAGE.PROVIDER, failed, total: n, err: reason?.message },
      "fallaron variantes de imagen"
    );
  }

  if (!images.length) {
    log.error(
      { provider: DEFAULTS.LLM.IMAGE.PROVIDER },
      "no se genero ninguna variante, el caller debe degradar a la foto real"
    );
    return empty;
  }

  log.info(
    { provider: DEFAULTS.LLM.IMAGE.PROVIDER, model: provider.model, count: images.length },
    "variantes de imagen generadas"
  );
  return { images, model: provider.model };
};
