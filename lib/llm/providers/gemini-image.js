/**
 * Adapter de generacion de imagenes de Google Gemini (image-to-image) via fetch
 * directo a generateContent. Separado del adapter de texto (providers/gemini.js)
 * porque es una capacidad distinta y un modelo distinto (GEMINI_IMAGE_MODEL).
 *
 * image-to-image: recibe una imagen de referencia (la foto real del producto) como
 * inlineData + un prompt de texto, y devuelve UNA imagen generada (base64 + mime).
 * Reusa GEMINI_API_KEY (no tiene API key propia). El cliente que lo envuelve
 * (lib/llm/image.js) es best-effort: aca solo lanzamos si algo falla.
 */
import { DEFAULTS } from "../../../config.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/** Primer part con inlineData (la imagen) en la respuesta de Gemini. */
const firstInlineImage = (data) => {
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const inline = part.inlineData ?? part.inline_data;
    if (inline?.data) {
      return { data: inline.data, mimeType: inline.mimeType ?? inline.mime_type };
    }
  }
  return null;
};

export const geminiImageProvider = {
  get model() {
    return DEFAULTS.LLM.IMAGE.GEMINI_MODEL;
  },

  /**
   * Genera UNA imagen a partir de un prompt + una imagen de referencia.
   *
   * @param {object} args
   * @param {string} args.prompt - prompt de construccion de la imagen.
   * @param {{ data: string, mimeType: string }} [args.referenceImage] - imagen de
   *   referencia en base64 (la foto del producto). Si falta, es text-to-image.
   * @returns {Promise<{ data: string, mimeType: string }>} imagen en base64.
   */
  async generateImage({ prompt, referenceImage }) {
    const apiKey = DEFAULTS.LLM.GEMINI.API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY no configurada");
    }

    const url = `${BASE}/${this.model}:generateContent?key=${apiKey}`;

    const parts = [{ text: prompt }];
    if (referenceImage?.data) {
      parts.push({
        inlineData: {
          mimeType: referenceImage.mimeType ?? "image/jpeg",
          data: referenceImage.data,
        },
      });
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Gemini image ${res.status}: ${detail.slice(0, 200)}`);
    }

    const image = firstInlineImage(await res.json());
    if (!image) {
      throw new Error("Gemini image: respuesta sin imagen");
    }
    return image;
  },
};
