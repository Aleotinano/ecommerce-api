/**
 * Pipeline de construccion del prompt de imagen publicitaria. Razona en espacio de
 * texto (barato) antes de gastar la generacion de imagen (cara).
 *
 * Dos niveles:
 *  - buildImagePrompt(...)  -> PURO y deterministico (sin red). Es el MVP de 1
 *    etapa y, ademas, el FALLBACK cuando el pipeline LLM falla.
 *  - composeImagePrompt(...) -> best-effort multi-etapa: (1) ver->describir la foto
 *    real con un LLM multimodal, (2) skill de disenador que redacta el prompt final.
 *    Si algo falla, degrada al builder deterministico. NUNCA lanza.
 *
 * El prompt resultante alimenta lib/llm/image.js (generateImages). Ver docs:
 * "Sugerencias de contenido — Imagenes (propuesta)".
 */
import { DEFAULTS } from "../../config.js";
import { logger } from "../logger.js";
import { anthropicProvider } from "./providers/anthropic.js";
import { geminiProvider } from "./providers/gemini.js";

const log = logger.child({ module: "image-prompt" });

const PROVIDERS = {
  anthropic: anthropicProvider,
  gemini: geminiProvider,
};

/** Provider de TEXTO configurado (LLM_PROVIDER), para las etapas del pipeline. */
const textProvider = () => PROVIDERS[DEFAULTS.LLM.PROVIDER] ?? geminiProvider;

/**
 * Tono VISUAL por angulo (el equivalente para imagen de ANGLE_BRIEFS, que es para
 * texto). Es un dato de mood, no una orden de escribir nada en la imagen.
 */
const ANGLE_VISUAL_TONE = {
  BEST_SELLER:
    "aspiracional y calido, con onda de producto querido y elegido por muchos",
  NEW_ARRIVAL:
    "fresco, moderno y limpio, con energia de lanzamiento y novedad",
  LOW_STOCK:
    "con foco y protagonismo, spotlight sobre el producto, sensacion de pieza especial",
  NO_RECENT_SALES:
    "de redescubrimiento, encanto y detalle, que invite a mirar el producto de nuevo",
};

const cleanLine = (label, value) => (value ? `${label}: ${value}` : null);

/**
 * Construye un prompt de imagen deterministico a partir de datos estructurados.
 * Puro: misma entrada -> misma salida, sin red. Honra las opciones de overlay
 * (texto/precio se aplican DESPUES con Cloudinary, no los dibuja el modelo).
 *
 * @param {object} args
 * @param {object} args.product - { name, description, price, category:{name} }
 * @param {string} args.angle - SuggestionAngle
 * @param {object} [args.config] - TenantConfig (branding)
 * @param {object} [args.options] - { imagen, infoEnPantalla, precioEnPantalla }
 * @returns {string} prompt final de imagen.
 */
export const buildImagePrompt = ({ product, angle, config, options = {} }) => {
  const storeName = config?.storeName || "la tienda";
  const tone = ANGLE_VISUAL_TONE[angle] ?? ANGLE_VISUAL_TONE.BEST_SELLER;
  const reserveSpace = Boolean(options.infoEnPantalla || options.precioEnPantalla);

  const brand = [
    `Marca: "${storeName}"`,
    config?.storeTagline ? `lema "${config.storeTagline}"` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const lines = [
    "Foto publicitaria profesional para redes sociales de una tienda de indumentaria online.",
    brand + ".",
    cleanLine("Producto", product?.name),
    cleanLine("Categoria", product?.category?.name),
    cleanLine("Detalle del producto", product?.description),
    config?.storeDescription ? `Identidad de marca: ${config.storeDescription}.` : null,
    "Estilo: fotografia de producto de alta calidad, iluminacion de estudio, composicion limpia y moderna, aspecto premium de ecommerce.",
    `Tono visual segun el momento de la publicacion: ${tone}.`,
    // El producto debe quedar fiel a la foto real (image-to-image): se mejora el
    // entorno, la luz y el fondo, NO el producto.
    "Mantene el producto fiel a la foto de referencia (mismo color, forma y detalles); mejora el entorno, la luz y el fondo, no el producto.",
    reserveSpace
      ? "Composicion: deja un area amplia y despejada (parte superior o inferior) con fondo simple para sobreimprimir texto despues."
      : null,
    // Los modelos image-to-image escriben texto con errores: el texto/precio se
    // agrega como overlay aparte (Cloudinary). Nunca pedir texto en la imagen.
    "NO escribas ningun texto, palabra, numero, precio ni logo dentro de la imagen.",
  ];

  return lines.filter(Boolean).join("\n");
};

/**
 * Etapa 1 — ver->describir: un LLM multimodal describe la foto real del producto
 * para reproducirlo fielmente. Devuelve null si no hay imagen (text-to-image).
 */
const describeImage = async ({ referenceImage }) => {
  if (!referenceImage?.data) return null;

  const system =
    "Sos un asistente que describe fotos de producto de indumentaria para alimentar un generador de imagenes. Se objetivo y conciso.";
  const user =
    "Describi el producto de la imagen para reproducirlo fielmente: tipo de prenda, color exacto, material/textura, corte y detalles distintivos. Una sola frase descriptiva, sin introducciones.";

  const text = await textProvider().generate({
    system,
    user,
    images: [referenceImage],
    json: false,
    maxTokens: 300,
  });
  return text?.trim() || null;
};

/**
 * Etapa 3 — skill de disenador: un director de arte toma el brief base (+ la
 * descripcion de la foto real) y redacta el prompt final optimizado. Devuelve
 * null si el modelo no responde.
 */
const designImagePrompt = async ({ base, description }) => {
  const system = [
    "Sos un director de arte publicitario experto en fotografia de producto para redes sociales.",
    "Tu tarea: a partir de un brief, redactar el PROMPT FINAL para un modelo de generacion de imagenes (image-to-image).",
    "Toma decisiones de diseno concretas: composicion, encuadre, iluminacion, fondo, paleta, ambiente y mood.",
    "Responde SOLO con el prompt final en espanol, sin explicaciones, sin comillas, sin titulos.",
    "Nunca pidas texto, palabras, numeros, precios ni logos dentro de la imagen.",
  ].join("\n");

  const user = [
    "Brief base (mejoralo, no lo copies tal cual):",
    base,
    description ? `\nDescripcion de la foto real del producto: ${description}` : null,
    "\nDevolve el prompt final optimizado.",
  ]
    .filter(Boolean)
    .join("\n");

  const text = await textProvider().generate({
    system,
    user,
    json: false,
    maxTokens: 600,
  });
  return text?.trim() || null;
};

/**
 * Orquesta el pipeline best-effort: ver->describir -> skill de disenador. Si la
 * vision falla, sigue sin descripcion; si el disenador falla, cae al builder
 * deterministico. NUNCA lanza.
 *
 * @returns {Promise<{ prompt: string, model: string|null, base: string, description: string|null }>}
 */
export const composeImagePrompt = async ({
  product,
  angle,
  config,
  options,
  referenceImage,
}) => {
  const base = buildImagePrompt({ product, angle, config, options });

  let description = null;
  try {
    description = await describeImage({ referenceImage });
  } catch (error) {
    log.warn({ err: error.message }, "fallo la etapa de vision, sigo sin descripcion");
  }

  try {
    const designed = await designImagePrompt({ base, description });
    if (designed) {
      log.info({ provider: DEFAULTS.LLM.PROVIDER }, "prompt de imagen compuesto por el pipeline");
      return { prompt: designed, model: textProvider().model, base, description };
    }
    log.warn("el disenador no devolvio prompt, uso el builder deterministico");
  } catch (error) {
    log.error(
      { err: error.message },
      "fallo la etapa de disenador, uso el builder deterministico"
    );
  }

  return { prompt: base, model: null, base, description };
};
