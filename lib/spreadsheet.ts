import ExcelJS from "exceljs";

/** A parsed spreadsheet: header row + data rows, all as strings. */
export interface ParsedSheet {
  headers: string[];
  rows: Record<string, string>[];
}

// ---- CSV --------------------------------------------------------------------

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      field = "";
      row = [];
    } else {
      field += c;
    }
  }
  // trailing field/row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function toParsedSheet(grid: string[][]): ParsedSheet {
  if (grid.length === 0) return { headers: [], rows: [] };
  const headers = grid[0].map((h) => h.trim());
  const rows = grid.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] ?? "").toString().trim();
    });
    return obj;
  });
  return { headers, rows };
}

// ---- XLSX -------------------------------------------------------------------

async function parseXlsx(buffer: Buffer): Promise<ParsedSheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return { headers: [], rows: [] };

  const grid: string[][] = [];
  ws.eachRow((row) => {
    const cells: string[] = [];
    // values is 1-indexed; index 0 is unused
    const values = row.values as unknown[];
    for (let i = 1; i < values.length; i++) {
      const v = values[i];
      cells.push(cellToString(v));
    }
    grid.push(cells);
  });
  return toParsedSheet(grid);
}

function cellToString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") {
    // exceljs rich text / hyperlink / formula result objects
    const anyV = v as Record<string, unknown>;
    if ("text" in anyV) return String(anyV.text);
    if ("result" in anyV) return String(anyV.result);
    if ("richText" in anyV && Array.isArray(anyV.richText)) {
      return (anyV.richText as { text: string }[]).map((t) => t.text).join("");
    }
  }
  return String(v).trim();
}

// ---- entry point ------------------------------------------------------------

export async function parseSpreadsheet(
  buffer: Buffer,
  filename: string
): Promise<ParsedSheet> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    return toParsedSheet(parseCsv(buffer.toString("utf8")));
  }
  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) {
    return parseXlsx(buffer);
  }
  throw new Error("Unsupported file type. Upload a .csv or .xlsx file.");
}

/** Find a header by trying several candidate names (case-insensitive). */
export function pickColumn(
  headers: string[],
  candidates: string[]
): string | null {
  const lc = headers.map((h) => h.toLowerCase());
  for (const cand of candidates) {
    const idx = lc.indexOf(cand.toLowerCase());
    if (idx !== -1) return headers[idx];
  }
  return null;
}
