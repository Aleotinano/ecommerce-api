import { describe, it, expect } from "vitest";
import { parseLlmJson } from "../lib/llm/parse.js";

describe("parseLlmJson", () => {
  it("parsea JSON limpio", () => {
    const out = parseLlmJson('{"copy":"Hola mundo","hashtags":["#uno","#dos"]}');
    expect(out).toEqual({ copy: "Hola mundo", hashtags: ["#uno", "#dos"] });
  });

  it("limpia fences ```json", () => {
    const text = '```json\n{"copy":"Con fences","hashtags":["#tag"]}\n```';
    expect(parseLlmJson(text)).toEqual({
      copy: "Con fences",
      hashtags: ["#tag"],
    });
  });

  it("limpia fences sin etiqueta de lenguaje", () => {
    const text = '```\n{"copy":"X","hashtags":[]}\n```';
    expect(parseLlmJson(text)).toEqual({ copy: "X", hashtags: [] });
  });

  it("recorta prosa alrededor del objeto", () => {
    const text =
      'Claro, aca tenes la publicacion:\n{"copy":"Mi copy","hashtags":["#a"]}\n Espero que te sirva!';
    expect(parseLlmJson(text)).toEqual({ copy: "Mi copy", hashtags: ["#a"] });
  });

  it("normaliza hashtags: agrega # y quita espacios", () => {
    const out = parseLlmJson(
      '{"copy":"c","hashtags":["sinNumeral"," con espacio ","#yaTiene"]}'
    );
    expect(out.hashtags).toEqual(["#sinNumeral", "#conespacio", "#yaTiene"]);
  });

  it("recorta a un maximo de 6 hashtags", () => {
    const tags = JSON.stringify(["#1", "#2", "#3", "#4", "#5", "#6", "#7", "#8"]);
    const out = parseLlmJson(`{"copy":"c","hashtags":${tags}}`);
    expect(out.hashtags).toHaveLength(6);
  });

  it("tolera hashtags ausentes o no-array", () => {
    expect(parseLlmJson('{"copy":"solo copy"}').hashtags).toEqual([]);
    expect(parseLlmJson('{"copy":"c","hashtags":"no-array"}').hashtags).toEqual(
      []
    );
  });

  it("devuelve null con basura no parseable", () => {
    expect(parseLlmJson("esto no es json")).toBeNull();
    expect(parseLlmJson("{ roto: ")).toBeNull();
  });

  it("devuelve null si falta copy o esta vacio", () => {
    expect(parseLlmJson('{"hashtags":["#a"]}')).toBeNull();
    expect(parseLlmJson('{"copy":"   ","hashtags":[]}')).toBeNull();
  });

  it("devuelve null con entradas vacias o no-string", () => {
    expect(parseLlmJson("")).toBeNull();
    expect(parseLlmJson(null)).toBeNull();
    expect(parseLlmJson(undefined)).toBeNull();
  });
});
