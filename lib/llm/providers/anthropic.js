/**
 * Adapter de Anthropic (Claude) via fetch directo a la Messages API.
 * No usamos `temperature` ni prefills: en Opus 4.x devuelven 400, y omitirlos es
 * seguro en Haiku/Sonnet/Opus por igual. El JSON-only se pide por system prompt.
 *
 * Ademas de `generate` (texto JSON, usado por content-suggestions), expone
 * `runTurn` para el chatbot con function calling: traduce el formato NEUTRO de
 * tools/mensajes al de Anthropic y parsea la salida a la forma neutra que consume
 * el loop agentico (lib/llm/agent.js). Es la unica pieza Anthropic-especifica.
 */
import { DEFAULTS } from "../../../config.js";

const ANTHROPIC_VERSION = "2023-06-01";

const endpoint = () => `${DEFAULTS.LLM.ANTHROPIC.BASE_URL}/v1/messages`;

const headers = (apiKey) => ({
  "content-type": "application/json",
  "x-api-key": apiKey,
  "anthropic-version": ANTHROPIC_VERSION,
});

/** Tools neutras -> tools[] de Anthropic con `input_schema` (JSON-schema). */
const toAnthropicTools = (tools = []) => {
  if (!tools.length) return undefined;
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    // El schema neutro ya es JSON-schema (type/properties/required). Anthropic
    // acepta un object sin properties (a diferencia de Gemini), asi que basta con
    // garantizar la forma minima.
    input_schema: {
      type: "object",
      properties: t.parameters?.properties ?? {},
      ...(t.parameters?.required?.length
        ? { required: t.parameters.required }
        : {}),
    },
  }));
};

/**
 * Mensajes neutros del loop -> messages de Anthropic (content por bloques).
 *
 * Anthropic exige que cada `tool_use` (en el turno del assistant) tenga un `id` y
 * que el `tool_result` siguiente lo referencie. El formato neutro NO lleva ids: el
 * assistant trae `toolCalls:[{name,args}]` y el turno `tool` trae `results` en el
 * MISMO orden. Sinttetizamos ids deterministas por posicion y emparejamos por
 * orden el bloque tool_use de un turno con el result correspondiente del siguiente.
 */
const toAnthropicMessages = (messages = []) => {
  const out = [];
  let lastIds = []; // ids del ultimo turno assistant con tool_use, en orden

  messages.forEach((m, i) => {
    if (m.role === "tool") {
      const content = (m.results ?? []).map((r, j) => ({
        type: "tool_result",
        tool_use_id: lastIds[j] ?? `call_${i}_${j}`,
        content: JSON.stringify(r.response ?? {}),
      }));
      out.push({ role: "user", content });
      return;
    }

    if (m.role === "assistant" && m.toolCalls?.length) {
      const ids = [];
      const content = m.toolCalls.map((c, j) => {
        const id = `call_${i}_${j}`;
        ids.push(id);
        return { type: "tool_use", id, name: c.name, input: c.args ?? {} };
      });
      lastIds = ids;
      out.push({ role: "assistant", content });
      return;
    }

    out.push({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content ?? "",
    });
  });

  return out;
};

/** Salida de Anthropic -> forma neutra { text, toolCalls } que consume el loop. */
const parseAnthropicTurn = (data) => {
  const blocks = data?.content ?? [];
  const texts = [];
  const toolCalls = [];
  for (const b of blocks) {
    if (b.type === "tool_use") {
      toolCalls.push({ name: b.name, args: b.input ?? {} });
    } else if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
      texts.push(b.text);
    }
  }
  return { text: texts.join("\n").trim() || null, toolCalls };
};

export const anthropicProvider = {
  get model() {
    return DEFAULTS.LLM.ANTHROPIC.MODEL;
  },

  async generate({ system, user, images, maxTokens = 1024 }) {
    const apiKey = DEFAULTS.LLM.ANTHROPIC.API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY no configurada");
    }

    // Multimodal opcional: las imagenes (base64) van como bloques image antes del
    // texto. Lo usa la etapa "ver->describir" del pipeline de imagen.
    const content = images?.length
      ? [
          ...images
            .filter((img) => img?.data)
            .map((img) => ({
              type: "image",
              source: {
                type: "base64",
                media_type: img.mimeType ?? "image/jpeg",
                data: img.data,
              },
            })),
          { type: "text", text: user },
        ]
      : user;

    const res = await fetch(endpoint(), {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify({
        model: this.model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content }],
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
   * Un turno del loop agentico con function calling. Devuelve la forma neutra
   * { text, toolCalls:[{ name, args }] }: si hay toolCalls el loop las ejecuta y
   * vuelve a llamar; si hay text (y nada de tools) es la respuesta final. Mismo
   * contrato que geminiProvider.runTurn.
   */
  async runTurn({ system, messages, tools, maxTokens = 1024 }) {
    const apiKey = DEFAULTS.LLM.ANTHROPIC.API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY no configurada");
    }

    const body = {
      model: this.model,
      max_tokens: maxTokens,
      messages: toAnthropicMessages(messages),
    };
    if (system) body.system = system;
    const anthropicTools = toAnthropicTools(tools);
    if (anthropicTools) body.tools = anthropicTools;

    const res = await fetch(endpoint(), {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Anthropic ${res.status}: ${detail.slice(0, 200)}`);
    }

    return parseAnthropicTurn(await res.json());
  },
};
