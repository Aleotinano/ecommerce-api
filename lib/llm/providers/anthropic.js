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
};
