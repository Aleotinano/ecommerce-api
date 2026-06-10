/**
 * Adapter de Google Gemini via fetch directo a generateContent.
 * Pedimos responseMimeType application/json (reduce fences), pero igual el
 * parseo posterior es defensivo. El system va en systemInstruction.
 */
import { DEFAULTS } from "../../../config.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export const geminiProvider = {
  get model() {
    return DEFAULTS.LLM.GEMINI.MODEL;
  },

  async generate({ system, user, maxTokens = 1024 }) {
    const apiKey = DEFAULTS.LLM.GEMINI.API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY no configurada");
    }

    const url = `${BASE}/${this.model}:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: maxTokens,
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Gemini ${res.status}: ${detail.slice(0, 200)}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error("Gemini: respuesta sin texto");
    }
    return text;
  },
};
