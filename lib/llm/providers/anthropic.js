/**
 * Adapter de Anthropic (Claude) via fetch directo a la Messages API.
 * No usamos `temperature` ni prefills: en Opus 4.x devuelven 400, y omitirlos es
 * seguro en Haiku/Sonnet/Opus por igual. El JSON-only se pide por system prompt.
 */
import { DEFAULTS } from "../../../config.js";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export const anthropicProvider = {
  get model() {
    return DEFAULTS.LLM.ANTHROPIC.MODEL;
  },

  async generate({ system, user, maxTokens = 1024 }) {
    const apiKey = DEFAULTS.LLM.ANTHROPIC.API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY no configurada");
    }

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Anthropic ${res.status}: ${detail.slice(0, 200)}`);
    }

    const data = await res.json();
    const text = data?.content?.[0]?.text;
    if (!text) {
      throw new Error("Anthropic: respuesta sin texto");
    }
    return text;
  },

  /**
   * Interfaz lista para el loop agentico con function calling (chatbot). El loop,
   * los handlers de tools y el rate limit son provider-agnosticos; lo unico que
   * varia aca es (a) traducir las tools neutras a `tools[]` con `input_schema` y
   * los mensajes neutros a `messages` con bloques `tool_use`/`tool_result`, y
   * (b) parsear la salida: `stop_reason: "tool_use"` + bloques `tool_use` ->
   * toolCalls, o el bloque `text` -> texto final, devolviendo la forma neutra
   * { text, toolCalls:[{ id, name, args }] }.
   *
   * Hoy se arranca con Gemini; este adapter queda definido como interfaz. Cuando
   * se implemente en prod, debe respetar el mismo contrato que geminiProvider.runTurn.
   */
  async runTurn() {
    throw new Error(
      "ANTHROPIC_CHAT_NOT_IMPLEMENTED: usar LLM_PROVIDER=gemini para el chat"
    );
  },
};
