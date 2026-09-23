/**
 * Minimal RFC 4180 CSV writer, shared by every export route (FASE 9, M12
 * point 9.1: "no CSV util exists yet"). Pure string building -- no I/O, no
 * streaming; callers page through the DB and append rows incrementally
 * (see `modules/libro/application/exportar-libro.ts`).
 *
 * Two defensive concerns beyond plain RFC 4180 quoting:
 *   - UTF-8 BOM prefix ("﻿") so Excel (still the most common opener
 *     for a "descargar CSV" link) detects UTF-8 instead of guessing the
 *     system codepage and mangling accented characters (á, é, ñ, ...).
 *   - CSV/Excel formula injection: a cell whose FIRST character is one of
 *     `= + - @` (or a raw tab/CR) is interpreted by some spreadsheet
 *     programs as the start of a formula when the file is opened, which
 *     is a known injection vector for any app that lets user-controlled
 *     text (paciente/médico/motivo free text, in this codebase) reach a
 *     CSV export. Every such cell is neutralized by prefixing a single
 *     quote character (`'`) BEFORE RFC 4180 quoting is applied -- Excel
 *     and most spreadsheet readers treat a leading `'` as "force text",
 *     stripping it from the visible value.
 */

const RFC4180_LINE_BREAK = "\r\n";
const FORMULA_INJECTION_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

/** `true` when `value`'s first character could be read as a spreadsheet formula/control sequence by Excel/Sheets/LibreOffice. */
function looksLikeFormulaInjection(value: string): boolean {
  return FORMULA_INJECTION_PREFIXES.some((prefix) => value.startsWith(prefix));
}

/** Neutralizes a single cell for safe spreadsheet consumption (injection guard), leaving normal text untouched. */
export function sanitizeCsvCell(value: string): string {
  return looksLikeFormulaInjection(value) ? `'${value}` : value;
}

/** Quotes one field per RFC 4180: wrapped in `"..."` (doubling any embedded `"`) whenever it contains a comma, quote, or line break -- left bare otherwise. */
function quoteField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Builds one CSV row (sanitized + quoted + comma-joined), WITHOUT a trailing line break. */
export function csvRow(cells: readonly (string | number | null | undefined)[]): string {
  return cells.map((cell) => quoteField(sanitizeCsvCell(cell === null || cell === undefined ? "" : String(cell)))).join(",");
}

/**
 * Builds a complete CSV document (UTF-8 BOM + header row + data rows,
 * CRLF line breaks per RFC 4180) from plain string/number matrices.
 */
export function buildCsv(header: readonly string[], rows: ReadonlyArray<readonly (string | number | null | undefined)[]>): string {
  const lines = [csvRow(header), ...rows.map((row) => csvRow(row))];
  return "﻿" + lines.join(RFC4180_LINE_BREAK) + RFC4180_LINE_BREAK;
}

/**
 * Incremental writer for paged exports: `header()` once, then `push(row)`
 * per row as pages arrive from the DB, `toString()` at the end. Avoids
 * holding every row's rendered line twice (matrix + joined string) for a
 * large export -- see `exportar-libro.ts`'s cap/paging discipline.
 */
export class CsvWriter {
  private readonly lines: string[] = [];

  constructor(header: readonly string[]) {
    this.lines.push(csvRow(header));
  }

  push(row: readonly (string | number | null | undefined)[]): void {
    this.lines.push(csvRow(row));
  }

  get rowCount(): number {
    return this.lines.length - 1;
  }

  toString(): string {
    return "﻿" + this.lines.join(RFC4180_LINE_BREAK) + RFC4180_LINE_BREAK;
  }
}
