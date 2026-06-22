/**
 * Fachada del cliente LLM con el proveedor desacoplado por env (LLM_PROVIDER).
 * Interfaz unica: generateCopy({ product, angle, config }) -> { copy, hashtags, model }.
 *
 * Best-effort, igual que lib/mailer: NUNCA lanza. Si el adapter falla, no hay
 * API key, o el JSON es invalido, devuelve un copy de fallback por template con
 * model: null, para que la sugerencia se persista igual.
 */
import { DEFAULTS } from "../../config.js";
import { logger } from "../logger.js";
import { anthropicProvider } from "./providers/anthropic.js";
import { geminiProvider } from "./providers/gemini.js";
import { buildPrompt } from "./prompt.js";
import { parseLlmJson } from "./parse.js";
import { buildFallbackCopy } from "./fallback.js";

const log = logger.child({ module: "llm" });

const PROVIDERS = {
  anthropic: anthropicProvider,
  gemini: geminiProvider,
};

const MAX_TOKENS = 1024;

export const generateCopy = async ({ product, angle, config, refinement }) => {
  const provider = PROVIDERS[DEFAULTS.LLM.PROVIDER] ?? geminiProvider;
  const { system, user } = buildPrompt({ product, angle, config, refinement });

  // En refinamiento el fallback es devolver el copy previo intacto (no inventar uno
  // nuevo por template); en generacion normal cae al fallback por template.
  const fallback = refinement
    ? { copy: refinement.baseCopy, hashtags: refinement.baseHashtags ?? [] }
    : buildFallbackCopy({ product, angle, config });

  try {
    const raw = await provider.generate({ system, user, maxTokens: MAX_TOKENS });
    const parsed = parseLlmJson(raw);

    if (!parsed) {
      log.warn(
        { provider: DEFAULTS.LLM.PROVIDER, model: provider.model },
        "respuesta LLM invalida, usando fallback"
      );
      return { ...fallback, model: null };
    }

    log.info(
      { provider: DEFAULTS.LLM.PROVIDER, model: provider.model },
      "copy generado por LLM"
    );
    return { ...parsed, model: provider.model };
  } catch (error) {
    log.error(
      { err: error.message, provider: DEFAULTS.LLM.PROVIDER },
      "fallo la generacion con LLM, usando fallback"
    );
    return { ...fallback, model: null };
  }
};

/**
 * Pide una variacion de un copy ya generado (mas corto / informal / vendedor /
 * cambio libre). Reusa generateCopy con el bloque de refinamiento; no persiste.
 */
export const refineCopy = ({ product, angle, config, mode, instruction, baseCopy, baseHashtags }) =>
  generateCopy({
    product,
    angle,
    config,
    refinement: { mode, instruction, baseCopy, baseHashtags },
  });
