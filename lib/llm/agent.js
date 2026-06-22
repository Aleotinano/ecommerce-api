/**
 * Loop agentico provider-agnostico para el chatbot del storefront.
 *
 * Arma la conversacion neutra (system + history saneado + mensaje nuevo), llama
 * al provider con las tools y, mientras el modelo pida tools, ejecuta cada una
 * server-side (via `executeTool`, donde vive la seguridad de tenant), anexa los
 * resultados y vuelve a llamar. Cuando el modelo responde texto sin tools, corta.
 *
 * El provider es lo UNICO que cambia entre Gemini/Anthropic: este loop, los
 * handlers de tools y el rate limit no dependen de el. La seleccion sigue el
 * mismo patron que lib/llm/index.js (DEFAULTS.LLM.PROVIDER), sin tocar ese archivo.
 *
 * Best-effort: si el provider falla (red, sin API key, formato inesperado),
 * loguea y devuelve un texto amable de error en vez de propagar un 500 crudo.
 */
import { DEFAULTS } from "../../config.js";
import { logger } from "../logger.js";
import { anthropicProvider } from "./providers/anthropic.js";
import { geminiProvider } from "./providers/gemini.js";

const log = logger.child({ module: "llm:agent" });

const PROVIDERS = {
  anthropic: anthropicProvider,
  gemini: geminiProvider,
};

const MAX_TOKENS = 1024;

/** Mensaje de cierre amable cuando algo no se puede completar. */
const FALLBACK_REPLY =
  "Perdona, ahora mismo no puedo procesar tu consulta. Probá de nuevo en un ratito.";

/**
 * Sanea el history que viene del cliente: solo roles validos, content string no
 * vacio, recortado a los ultimos `maxHistory` turnos. Defensa en profundidad
 * sobre el zod del endpoint (el history es input no confiable).
 */
const sanitizeHistory = (history = [], maxHistory = 20) =>
  (Array.isArray(history) ? history : [])
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim()
    )
    .slice(-maxHistory)
    .map((m) => ({ role: m.role, content: m.content.trim() }));

/**
 * Ejecuta el loop multi-turn.
 *
 * @param {object}   p
 * @param {string}   p.system        System prompt del bot.
 * @param {Array}    p.history       Historial cliente [{ role, content }] (no confiable).
 * @param {string}   p.message       Mensaje nuevo del usuario.
 * @param {Array}    p.tools         Tool specs neutras disponibles para este turno.
 * @param {Function} p.executeTool   async (name, args) => resultado (vista limitada).
 * @param {number}   [p.maxIterations=6]
 * @returns {Promise<{ reply: string, iterations: number }>}
 */
export const runAgent = async ({
  system,
  history,
  message,
  tools = [],
  executeTool,
  maxIterations = 6,
}) => {
  const provider = PROVIDERS[DEFAULTS.LLM.PROVIDER] ?? geminiProvider;

  const messages = [
    ...sanitizeHistory(history),
    { role: "user", content: message },
  ];

  try {
    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
      const { text, toolCalls } = await provider.runTurn({
        system,
        messages,
        tools,
        maxTokens: MAX_TOKENS,
      });

      if (!toolCalls?.length) {
        return { reply: text || FALLBACK_REPLY, iterations: iteration };
      }

      // El modelo pidio tool(s): registramos el turno del assistant y ejecutamos
      // cada una con el contexto del servidor (tenant/user) via executeTool.
      messages.push({ role: "assistant", toolCalls });

      const results = [];
      for (const call of toolCalls) {
        let response;
        try {
          response = await executeTool(call.name, call.args ?? {});
        } catch (err) {
          log.warn({ err: err.message, tool: call.name }, "tool ejecucion fallo");
          response = { error: "No se pudo obtener el dato." };
        }
        results.push({ name: call.name, response });
      }

      messages.push({ role: "tool", results });
    }

    // Se agotaron las iteraciones sin una respuesta final de texto.
    log.warn({ maxIterations }, "loop agentico agoto iteraciones");
    return {
      reply:
        "Me cuesta resolver esa consulta. ¿Podés reformularla o contarme un poco más?",
      iterations: maxIterations,
    };
  } catch (err) {
    log.error(
      { err: err.message, provider: DEFAULTS.LLM.PROVIDER },
      "fallo el loop agentico del chat"
    );
    return { reply: FALLBACK_REPLY, iterations: 0 };
  }
};
