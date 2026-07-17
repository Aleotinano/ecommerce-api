/**
 * Adapter de Google Gemini via fetch directo a generateContent.
 * Pedimos responseMimeType application/json (reduce fences), pero igual el
 * parseo posterior es defensivo. El system va en systemInstruction.
 *
 * Ademas de `generate` (texto JSON, usado por content-suggestions), expone
 * `runTurn` para el chatbot con function calling: traduce el formato NEUTRO de
 * tools/mensajes al de Gemini y parsea la salida a la forma neutra que consume
 * el loop agentico (lib/llm/agent.js). Es la unica pieza Gemini-especifica.
 */
import { DEFAULTS } from "../../../config.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/** Mapea tipos del JSON-schema neutro a los enums de Schema de Gemini. */
const GEMINI_TYPES = {
  object: "OBJECT",
  string: "STRING",
  integer: "INTEGER",
  number: "NUMBER",
  boolean: "BOOLEAN",
  array: "ARRAY",
};

/** Traduce un schema neutro de parametros al Schema de Gemini (tipos en MAYUS). */
const toGeminiSchema = (schema) => {
  if (!schema || typeof schema !== "object") return undefined;
  // Gemini rechaza un OBJECT sin properties tambien anidado (ej: el mapa libre
  // `attributes` de las tools de variantes): ese caso viaja como STRING con el
  // JSON serializado — los handlers (services/chat/tools.js) lo parsean defensivo.
  if (
    schema.type === "object" &&
    (!schema.properties || !Object.keys(schema.properties).length)
  ) {
    return {
      type: "STRING",
      description: [schema.description, "(objeto JSON serializado como string)"]
        .filter(Boolean)
        .join(" "),
    };
  }
  const out = { type: GEMINI_TYPES[schema.type] ?? "OBJECT" };
  if (schema.description) out.description = schema.description;
  if (schema.properties) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([k, v]) => [k, toGeminiSchema(v)])
    );
  }
  if (schema.items) out.items = toGeminiSchema(schema.items);
  if (Array.isArray(schema.required) && schema.required.length) {
    out.required = schema.required;
  }
  return out;
};

/** Tools neutras -> tools[].functionDeclarations de Gemini. */
const toGeminiTools = (tools = []) => {
  if (!tools.length) return undefined;
  return [
    {
      functionDeclarations: tools.map((t) => {
        const decl = { name: t.name, description: t.description };
        // Gemini rechaza un schema OBJECT sin properties: omitimos parameters
        // cuando la tool no recibe argumentos (ej: listCategories).
        const hasProps =
          t.parameters?.properties &&
          Object.keys(t.parameters.properties).length > 0;
        if (hasProps) decl.parameters = toGeminiSchema(t.parameters);
        return decl;
      }),
    },
  ];
};

/** Mensajes neutros del loop -> contents de Gemini. */
const toGeminiContents = (messages = []) =>
  messages.map((m) => {
    if (m.role === "tool") {
      return {
        role: "user",
        parts: (m.results ?? []).map((r) => ({
          functionResponse: { name: r.name, response: r.response ?? {} },
        })),
      };
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "model",
        parts: m.toolCalls.map((c) => ({
          functionCall: { name: c.name, args: c.args ?? {} },
        })),
      };
    }
    return {
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content ?? "" }],
    };
  });

/** Salida de Gemini -> forma neutra { text, toolCalls } que consume el loop. */
const parseGeminiTurn = (data) => {
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const texts = [];
  const toolCalls = [];
  for (const part of parts) {
    if (part.functionCall) {
      toolCalls.push({
        name: part.functionCall.name,
        args: part.functionCall.args ?? {},
      });
    } else if (typeof part.text === "string" && part.text.trim()) {
      texts.push(part.text);
    }
  }
  return { text: texts.join("\n").trim() || null, toolCalls };
};

export const geminiProvider = {
  get model() {
    return DEFAULTS.LLM.GEMINI.MODEL;
  },

  async generate({ system, user, images, maxTokens = 1024, json = true }) {
    const apiKey = DEFAULTS.LLM.GEMINI.API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY no configurada");
    }

    const url = `${BASE}/${this.model}:generateContent?key=${apiKey}`;

    // Multimodal opcional: las imagenes (base64) van como inlineData en el mismo
    // turno user. Lo usa la etapa "ver->describir" del pipeline de imagen.
    const parts = [{ text: user }];
    for (const img of images ?? []) {
      if (img?.data) {
        parts.push({
          inlineData: { mimeType: img.mimeType ?? "image/jpeg", data: img.data },
        });
      }
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          // JSON estricto para content-suggestions; texto plano para el pipeline
          // de prompt de imagen (describir / disenar), que no devuelve JSON.
          ...(json ? { responseMimeType: "application/json" } : {}),
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

  /**
   * Un turno del loop agentico con function calling. Devuelve la forma neutra
   * { text, toolCalls:[{ name, args }] }: si hay toolCalls el loop las ejecuta y
   * vuelve a llamar; si hay text (y nada de tools) es la respuesta final.
   */
  async runTurn({ system, messages, tools, maxTokens = 1024 }) {
    const apiKey = DEFAULTS.LLM.GEMINI.API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY no configurada");
    }

    const url = `${BASE}/${this.model}:generateContent?key=${apiKey}`;

    const body = {
      contents: toGeminiContents(messages),
      generationConfig: { maxOutputTokens: maxTokens },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    const geminiTools = toGeminiTools(tools);
    if (geminiTools) body.tools = geminiTools;

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Gemini ${res.status}: ${detail.slice(0, 200)}`);
    }

    return parseGeminiTurn(await res.json());
  },
};
