/**
 * A small, strict CSV reader (RFC 4180): quoted fields, doubled quotes, line breaks inside quotes,
 * UTF-8 BOM, CRLF/LF, and automatic comma/semicolon detection (Excel in Azerbaijani and Russian
 * locales saves semicolon-separated files). Returns problems instead of throwing.
 */
export const CSV_LIMITS = { maxBytes: 1_000_000, maxRows: 200, maxCellLength: 25_000 } as const;

export type CsvProblem = "empty" | "too_large" | "too_many_rows" | "unclosed_quote" | "cell_too_long" | "binary";

export interface ParsedCsv {
  delimiter: "," | ";" | "\t";
  headers: string[];
  /** Data rows with their 1-based line numbers in the file (header = line 1). */
  rows: { line: number; cells: string[] }[];
  problems: CsvProblem[];
}

function detectDelimiter(firstLine: string): "," | ";" | "\t" {
  let inQuotes = false;
  const counts = { ",": 0, ";": 0, "\t": 0 };
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === "," || ch === ";" || ch === "\t")) counts[ch]++;
  }
  return counts[";"] > counts[","] && counts[";"] >= counts["\t"] ? ";" : counts["\t"] > counts[","] ? "\t" : ",";
}

export function parseCsv(input: string): ParsedCsv {
  const empty = (problems: CsvProblem[]): ParsedCsv => ({ delimiter: ",", headers: [], rows: [], problems });
  if (new TextEncoder().encode(input).length > CSV_LIMITS.maxBytes) return empty(["too_large"]);
  if (/[\u0000-\u0008\u000e-\u001f]/.test(input)) return empty(["binary"]);
  const text = input.replace(/^﻿/, "");
  if (text.trim() === "") return empty(["empty"]);

  const delimiter = detectDelimiter(text.split(/\r?\n/, 1)[0] ?? "");
  const records: { line: number; cells: string[] }[] = [];
  const problems = new Set<CsvProblem>();
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;

  const endCell = () => {
    if (cell.length > CSV_LIMITS.maxCellLength) problems.add("cell_too_long");
    cells.push(cell);
    cell = "";
  };
  const endRecord = () => {
    endCell();
    records.push({ line: recordLine, cells });
    cells = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
    } else if (ch === '"' && cell === "") {
      inQuotes = true;
    } else if (ch === delimiter) {
      endCell();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      cell += ch;
    }
  }
  if (inQuotes) problems.add("unclosed_quote");
  if (cell !== "" || cells.length > 0) endRecord();

  const [head, ...body] = records;
  if (!head) return { ...empty(["empty"]), delimiter };
  const rows = body.filter((r) => r.cells.some((c) => c.trim() !== "")); // skip blank lines
  if (rows.length > CSV_LIMITS.maxRows) problems.add("too_many_rows");
  return { delimiter, headers: head.cells.map((h) => h.trim().toLowerCase()), rows: rows.slice(0, CSV_LIMITS.maxRows), problems: [...problems] };
}

/** Escapes one cell for writing. Cells that start with = + - @ are prefixed with an apostrophe-free guard (a leading space-less quote) so spreadsheets never run them as formulas. */
export function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",;\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}
