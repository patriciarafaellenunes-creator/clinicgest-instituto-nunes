import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvWithHeader } from "@/lib/csv";

describe("parseCsv", () => {
  it("faz parsing de campos simples separados por vírgula", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("preserva vírgulas dentro de campos entre aspas", () => {
    expect(parseCsv('nome,conversa\nJoão,"Oi, tudo bem?"')).toEqual([
      ["nome", "conversa"],
      ["João", "Oi, tudo bem?"],
    ]);
  });

  it("preserva quebras de linha dentro de campos entre aspas", () => {
    const input = 'nome,conversa\nJoão,"Cliente: oi\nAtendente: oi, tudo bem?"';
    const result = parseCsv(input);
    expect(result[1]![1]).toBe("Cliente: oi\nAtendente: oi, tudo bem?");
  });

  it("decodifica aspas escapadas (\"\")", () => {
    expect(parseCsv('texto\n"ela disse ""oi"""')).toEqual([["texto"], ['ela disse "oi"']]);
  });
});

describe("parseCsvWithHeader", () => {
  it("usa a primeira linha como cabeçalho (case-insensitive)", () => {
    const result = parseCsvWithHeader("Nome,Telefone\nMariana,11999990000");
    expect(result).toEqual([{ nome: "Mariana", telefone: "11999990000" }]);
  });

  it("retorna lista vazia para entrada vazia", () => {
    expect(parseCsvWithHeader("")).toEqual([]);
  });
});
