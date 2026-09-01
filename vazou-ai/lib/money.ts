/** Converte uma string em formato brasileiro ("3.500,00" ou "3500") para centavos. */
export function parseBrlToCents(input: string | null | undefined): number | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const normalized = trimmed
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "") // remove separador de milhar
    .replace(",", ".");

  const value = Number.parseFloat(normalized);
  if (Number.isNaN(value)) return null;
  return Math.round(value * 100);
}

export function formatCentsToBrl(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Aceita "DD/MM/AAAA" ou ISO ("AAAA-MM-DD"); retorna ISO ou null se inválida/vazia. */
export function parseFlexibleDateToIso(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const brMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (brMatch) {
    const [, d, m, y] = brMatch;
    // Date.UTC (não `new Date(y, m-1, d)`) evita que o fuso horário do
    // servidor desloque a data em um dia ao converter para ISO — importante
    // porque este valor alimenta lib/scoring.ts (recência do score).
    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
