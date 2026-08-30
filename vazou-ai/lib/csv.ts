/**
 * Parser CSV mínimo (RFC 4180): suporta campos entre aspas com vírgulas,
 * quebras de linha e aspas escapadas (""). Suficiente para o modelo de
 * importação do MVP (§1.6/§3.2 do PRD) sem depender de uma lib externa.
 */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  // Normaliza quebras de linha para simplificar o loop de leitura.
  const text = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

export interface CsvRecord {
  [column: string]: string;
}

/** Primeira linha vira cabeçalho; cada linha seguinte vira um objeto {coluna: valor}. */
export function parseCsvWithHeader(input: string): CsvRecord[] {
  const rows = parseCsv(input);
  if (rows.length === 0) return [];

  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((row) => {
    const record: CsvRecord = {};
    header.forEach((key, idx) => {
      record[key] = (row[idx] ?? "").trim();
    });
    return record;
  });
}
