import { describe, it, expect, beforeEach, vi } from "vitest";

// Mockeamos el provider Gemini: controlamos cada turno (text vs toolCalls).
const { runTurnMock } = vi.hoisted(() => ({ runTurnMock: vi.fn() }));
vi.mock("../lib/llm/providers/gemini.js", () => ({
  geminiProvider: { model: "test-model", generate: vi.fn(), runTurn: runTurnMock },
}));

const { runAgent } = await import("../lib/llm/agent.js");

describe("runAgent — loop agentico", () => {
  beforeEach(() => {
    runTurnMock.mockReset();
  });

  it("responde texto directo cuando el modelo no pide tools", async () => {
    runTurnMock.mockResolvedValue({ text: "Hola, soy el asistente", toolCalls: [] });

    const out = await runAgent({
      system: "sys",
      history: [],
      message: "hola",
      tools: [],
      executeTool: vi.fn(),
    });

    expect(out.reply).toBe("Hola, soy el asistente");
    expect(out.iterations).toBe(1);
  });

  it("ejecuta una tool, anexa el resultado y devuelve el texto final", async () => {
    runTurnMock
      .mockResolvedValueOnce({
        text: null,
        toolCalls: [{ name: "searchProducts", args: { query: "remera" } }],
      })
      .mockResolvedValueOnce({ text: "Tengo 1 remera", toolCalls: [] });

    const executeTool = vi.fn().mockResolvedValue({ productos: [{ name: "Remera" }] });

    const out = await runAgent({
      system: "sys",
      history: [],
      message: "buscar remeras",
      tools: [{ name: "searchProducts" }],
      executeTool,
    });

    expect(executeTool).toHaveBeenCalledWith("searchProducts", { query: "remera" });
    expect(out.reply).toBe("Tengo 1 remera");
    expect(out.iterations).toBe(2);

    // El segundo turno recibe el resultado de la tool en los mensajes.
    const secondCallMessages = runTurnMock.mock.calls[1][0].messages;
    const toolMsg = secondCallMessages.find((m) => m.role === "tool");
    expect(toolMsg.results[0].response.productos[0].name).toBe("Remera");
  });

  it("respeta maxIterations cuando el modelo pide tools sin parar", async () => {
    runTurnMock.mockResolvedValue({
      text: null,
      toolCalls: [{ name: "searchProducts", args: {} }],
    });
    const executeTool = vi.fn().mockResolvedValue({ ok: true });

    const out = await runAgent({
      system: "sys",
      history: [],
      message: "loop",
      tools: [{ name: "searchProducts" }],
      executeTool,
      maxIterations: 3,
    });

    expect(runTurnMock).toHaveBeenCalledTimes(3);
    expect(out.iterations).toBe(3);
    expect(out.reply).toMatch(/reformular|consulta/i);
  });

  it("una tool que falla no rompe el loop (devuelve error al modelo)", async () => {
    runTurnMock
      .mockResolvedValueOnce({
        text: null,
        toolCalls: [{ name: "x", args: {} }],
      })
      .mockResolvedValueOnce({ text: "listo", toolCalls: [] });

    const executeTool = vi.fn().mockRejectedValue(new Error("boom"));

    const out = await runAgent({
      system: "sys",
      history: [],
      message: "m",
      tools: [{ name: "x" }],
      executeTool,
    });

    expect(out.reply).toBe("listo");
    const toolMsg = runTurnMock.mock.calls[1][0].messages.find((m) => m.role === "tool");
    expect(toolMsg.results[0].response.error).toBeDefined();
  });

  it("si el provider lanza, devuelve un mensaje amable (no propaga)", async () => {
    runTurnMock.mockRejectedValue(new Error("network down"));

    const out = await runAgent({
      system: "sys",
      history: [],
      message: "m",
      tools: [],
      executeTool: vi.fn(),
    });

    expect(out.reply).toMatch(/no puedo procesar/i);
    expect(out.iterations).toBe(0);
  });

  it("sanea el history: descarta entradas invalidas y arma el primer turno", async () => {
    runTurnMock.mockResolvedValue({ text: "ok", toolCalls: [] });

    await runAgent({
      system: "sys",
      history: [
        { role: "user", content: "  valido  " },
        { role: "system", content: "inyectado" }, // rol invalido -> descartado
        { role: "assistant", content: "" }, // vacio -> descartado
      ],
      message: "nuevo",
      tools: [],
      executeTool: vi.fn(),
    });

    const messages = runTurnMock.mock.calls[0][0].messages;
    expect(messages).toEqual([
      { role: "user", content: "valido" },
      { role: "user", content: "nuevo" },
    ]);
  });
});
