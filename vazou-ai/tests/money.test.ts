import { describe, expect, it } from "vitest";
import { formatCentsToBrl, parseBrlToCents, parseFlexibleDateToIso } from "@/lib/money";

describe("parseBrlToCents", () => {
  it("converte formato brasileiro com separador de milhar", () => {
    expect(parseBrlToCents("3.500,00")).toBe(350000);
  });

  it("converte valor inteiro simples", () => {
    expect(parseBrlToCents("3500")).toBe(350000);
  });

  it("converte com prefixo de moeda e espaços", () => {
    expect(parseBrlToCents("R$ 1.890,50")).toBe(189050);
  });

  it("retorna null para vazio/inválido", () => {
    expect(parseBrlToCents("")).toBeNull();
    expect(parseBrlToCents(null)).toBeNull();
    expect(parseBrlToCents("abc")).toBeNull();
  });
});

describe("formatCentsToBrl", () => {
  it("formata centavos como moeda BRL", () => {
    expect(formatCentsToBrl(350000)).toContain("3.500,00");
  });

  it("retorna travessão para null/undefined", () => {
    expect(formatCentsToBrl(null)).toBe("—");
    expect(formatCentsToBrl(undefined)).toBe("—");
  });
});

describe("parseFlexibleDateToIso", () => {
  it("aceita formato brasileiro DD/MM/AAAA", () => {
    const iso = parseFlexibleDateToIso("26/08/2026");
    expect(iso).not.toBeNull();
    expect(new Date(iso!).getUTCFullYear()).toBe(2026);
  });

  it("aceita ISO", () => {
    expect(parseFlexibleDateToIso("2026-08-26")).not.toBeNull();
  });

  it("retorna null para vazio/inválido", () => {
    expect(parseFlexibleDateToIso("")).toBeNull();
    expect(parseFlexibleDateToIso("não é data")).toBeNull();
  });
});
