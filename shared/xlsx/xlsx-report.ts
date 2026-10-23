/**
 * Branded Excel (.xlsx) report builder, shared by every list export route
 * (recetas, kardex, stock valorizado, libro recetario, libro contralor,
 * cumplimiento de cierres). Replaces the former plain CSV exports: a CSV
 * cannot carry colors, a logo or column widths, and Excel in an es-AR locale
 * does not even split it into columns (it expects `;`, not `,`).
 *
 * Layout of every sheet:
 *   - rows 1-5: the tenant's own logo (when it uploaded a PNG or JPEG) next to the farmacia name,
 *     the report title, a short description of what it contains, the
 *     emission date and the applied filters;
 *   - a brand-colored rule, then the column header (brand green, white
 *     bold text), frozen and with auto-filter;
 *   - data rows with zebra striping; subtotal/total rows and notes (e.g.
 *     "truncated") styled apart.
 *
 * Cells are typed per column: dates and numbers are real Excel dates and
 * numbers (so they sort, filter and sum), shown as dd/mm/aaaa [hh:mm] and with
 * the viewer's own decimal separator. Text is always written as a string
 * value -- exceljs only emits a formula for an explicit `{ formula }` object,
 * so user text starting with `=`/`+`/`-`/`@` can never become one.
 */
import ExcelJS from "exceljs";
import { formatFechaHora } from "@/shared/format/fecha";
import { logoParaPdf } from "@/shared/pdf/logo";

/**
 * Zone instants (fecha de ingreso, fecha de firma, emisión) are shown in: the
 * schema default of `tenant.zona_horaria`. Export routes don't load the
 * tenant's own zone yet; every Argentine zone is UTC-3 without DST.
 */
export const REPORT_TIME_ZONE = "America/Argentina/Mendoza";

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";


/** ARGB versions of the `app/globals.css` theme tokens. */
const COLOR = {
  primary: "FF037A5C",
  brand: "FF03B386",
  ink: "FF0F1A17",
  muted: "FF65746F",
  border: "FFE2E8E6",
  zebra: "FFF5F7F7",
  subtotal: "FFEEF1F0",
  total: "FFDDF3EC",
  danger: "FFB42318",
  white: "FFFFFFFF",
} as const;

const FONT = "Calibri";
const FIRST_DATA_COLUMN_MIN_WIDTH = 10; // the logo sits over column A
/** Farmacia name, title, description, emission date, filters. */
const BANNER_ROWS = 5;
/** After the banner: the brand rule row and a spacer row. */
const HEADER_ROW = BANNER_ROWS + 3;
/** Characters of 10 pt text that fit in one Excel width unit (units are sized on 11 pt digits). */
const CHARS_PER_WIDTH_UNIT = 1.1;
const WRAPPED_LINE_HEIGHT = 14;

/** Row height (points) that shows `text` wrapped across `width` units without clipping it. */
function wrappedHeight(text: string, width: number): number {
  const lines = Math.max(1, Math.ceil(text.length / Math.max(1, width * CHARS_PER_WIDTH_UNIT)));
  return Math.max(16, lines * WRAPPED_LINE_HEIGHT + 2);
}

const NUM_FMT = {
  integer: "0",
  decimal: "#,##0.00##",
  money: '"$" #,##0.00',
  date: "dd/mm/yyyy",
  datetime: "dd/mm/yyyy hh:mm",
} as const;

export type XlsxColumnFormat = "text" | keyof typeof NUM_FMT;

export interface XlsxColumn {
  header: string;
  /** Width in Excel character units. */
  width: number;
  format?: XlsxColumnFormat;
  /** Wrap long text (fórmula, observación) instead of overflowing. */
  wrap?: boolean;
}

/**
 * A cell value: `string`/`number` as-is (a decimal string in a numeric
 * column becomes a number), a `YYYY-MM-DD` string or `Date` in a date column,
 * a `Date` instant in a datetime column. `null`/`undefined` is an empty cell.
 */
export type XlsxCell = string | number | Date | null | undefined;

export interface XlsxReportOptions {
  /** The tenant's name (nombre de fantasía or razón social): each farmacia's export carries its own, never a fixed brand. */
  farmacia: string;
  /** The tenant's uploaded logo (`getLogoTenant`), never a fixed file (docs/specs/logo-farmacia.md R6). Excel shows PNG and JPEG only: anything else, or none, draws the banner without it. */
  logo?: { bytes: Uint8Array; tipo: string } | null;
  title: string;
  /** One or two sentences under the title saying what the export contains. */
  description: string;
  /** Worksheet tab name (Excel caps it at 31 characters). */
  sheetName: string;
  issuedAt: Date;
  /** Readable summary of the applied filters; blank or omitted is written as "Sin filtros". */
  filters?: string;
  columns: readonly XlsxColumn[];
  timeZone?: string;
}

const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The wall-clock time of `instant` in `timeZone`, as a `Date` whose UTC
 * fields hold it: Excel dates have no zone and exceljs serializes a `Date`
 * from its UTC fields.
 */
export function toExcelWallClock(instant: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return new Date(Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second")));
}

/** Text that a spreadsheet would turn into a formula if the user edits the cell (OWASP CSV/formula injection). */
const PREFIJO_FORMULA = /^[=+\-@\t\r]/;

/** Stored text, quoted with `'` when it starts like a formula (security audit P4-03). */
export function textoSeguro(texto: string): string {
  return PREFIJO_FORMULA.test(texto) ? `'${texto}` : texto;
}

/** Converts a raw value to what the column's format stores. Unparseable input is kept as text, never dropped. */
export function toCellValue(value: XlsxCell, format: XlsxColumnFormat, timeZone: string): string | number | Date | null {
  const convertido = convertir(value, format, timeZone);
  return typeof convertido === "string" ? textoSeguro(convertido) : convertido;
}

function convertir(value: XlsxCell, format: XlsxColumnFormat, timeZone: string): string | number | Date | null {
  if (value === null || value === undefined || value === "") return null;
  switch (format) {
    case "integer":
    case "decimal":
    case "money":
      return typeof value === "string" && DECIMAL_STRING.test(value) ? Number(value) : value;
    case "date": {
      if (value instanceof Date) return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
      const match = typeof value === "string" ? ISO_DATE.exec(value) : null;
      return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : value;
    }
    case "datetime":
      return value instanceof Date ? toExcelWallClock(value, timeZone) : value;
    case "text":
      return value instanceof Date ? value.toISOString() : String(value);
  }
}

const thinBorder = (argb: string): Partial<ExcelJS.Border> => ({ style: "thin", color: { argb } });
const solidFill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

/**
 * Incremental report: `push` data rows as pages arrive from the DB,
 * `pushSummary` for subtotal/total lines, `pushNote` for a full-width
 * message, then `toBuffer()`.
 */
export class XlsxReport {
  private readonly workbook = new ExcelJS.Workbook();
  private readonly sheet: ExcelJS.Worksheet;
  private readonly columns: readonly XlsxColumn[];
  private readonly timeZone: string;
  private dataRows = 0;

  constructor(options: XlsxReportOptions) {
    this.columns = options.columns;
    this.timeZone = options.timeZone ?? REPORT_TIME_ZONE;
    this.workbook.creator = options.farmacia;
    this.workbook.created = options.issuedAt;
    this.sheet = this.workbook.addWorksheet(options.sheetName.slice(0, 31), {
      views: [{ state: "frozen", ySplit: HEADER_ROW, showGridLines: false }],
      pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${HEADER_ROW}:${HEADER_ROW}` },
      headerFooter: { oddFooter: `&L&8${options.farmacia} · ${options.title}&R&8Página &P de &N` },
    });
    this.sheet.columns = this.columns.map((column, index) => ({
      width: index === 0 ? Math.max(column.width, FIRST_DATA_COLUMN_MIN_WIDTH) : column.width,
    }));
    this.writeBanner(options);
    this.writeHeader();
  }

  get rowCount(): number {
    return this.dataRows;
  }

  push(values: readonly XlsxCell[]): void {
    const row = this.addRow(values);
    const zebra = this.dataRows % 2 === 1;
    this.dataRows += 1;
    this.forEachCell(row, (cell) => {
      cell.font = { name: FONT, size: 10, color: { argb: COLOR.ink } };
      cell.border = { bottom: thinBorder(COLOR.border) };
      if (zebra) cell.fill = solidFill(COLOR.zebra);
    });
  }

  /** A subtotal (light grey) or total (brand tint, bold rule above) line. */
  pushSummary(values: readonly XlsxCell[], kind: "subtotal" | "total"): void {
    const row = this.addRow(values);
    this.forEachCell(row, (cell) => {
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: kind === "total" ? COLOR.primary : COLOR.ink } };
      cell.fill = solidFill(kind === "total" ? COLOR.total : COLOR.subtotal);
      cell.border = kind === "total" ? { top: { style: "medium", color: { argb: COLOR.primary } } } : { bottom: thinBorder(COLOR.border) };
    });
  }

  /** A full-width message below the data (e.g. the truncation warning). */
  pushNote(text: string): void {
    const row = this.sheet.addRow([text]);
    this.mergeAcross(row.number);
    const cell = row.getCell(1);
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: COLOR.danger } };
    cell.alignment = { wrapText: true, vertical: "middle" };
    row.height = 30;
  }

  async toBuffer(): Promise<Buffer> {
    return Buffer.from(await this.workbook.xlsx.writeBuffer());
  }

  private addRow(values: readonly XlsxCell[]): ExcelJS.Row {
    const row = this.sheet.addRow(this.columns.map((column, index) => toCellValue(values[index], column.format ?? "text", this.timeZone)));
    this.columns.forEach((column, index) => {
      const cell = row.getCell(index + 1);
      const format = column.format ?? "text";
      if (format !== "text") cell.numFmt = NUM_FMT[format];
      const numeric = format === "integer" || format === "decimal" || format === "money";
      cell.alignment = { vertical: "top", wrapText: column.wrap ?? false, horizontal: numeric ? "right" : format === "text" ? "left" : "center" };
    });
    return row;
  }

  private writeBanner(options: XlsxReportOptions): void {
    const textColumn = this.columns.length > 1 ? 2 : 1;
    const bannerWidth = this.columns.slice(textColumn - 1).reduce((total, column) => total + column.width, 0);
    const lines: [string, Partial<ExcelJS.Font>, number][] = [
      [options.farmacia, { size: 16, bold: true, color: { argb: COLOR.primary } }, 24],
      [options.title, { size: 13, bold: true, color: { argb: COLOR.ink } }, 20],
      [options.description, { size: 10, italic: true, color: { argb: COLOR.ink } }, wrappedHeight(options.description, bannerWidth)],
      [`Fecha de emisión: ${formatFechaHora(options.issuedAt, this.timeZone)}`, { size: 10, color: { argb: COLOR.muted } }, 16],
      [`Filtros: ${options.filters?.trim() || "Sin filtros"}`, { size: 10, color: { argb: COLOR.muted } }, 16],
    ];
    lines.forEach(([text, font, height], index) => {
      const row = this.sheet.getRow(index + 1);
      row.height = height;
      const cell = row.getCell(textColumn);
      cell.value = text;
      cell.font = { name: FONT, ...font };
      cell.alignment = { vertical: "middle", wrapText: true };
      if (textColumn < this.columns.length) this.sheet.mergeCells(row.number, textColumn, row.number, this.columns.length);
    });

    // Brand rule under the banner, then a spacer before the table.
    const rule = this.sheet.getRow(BANNER_ROWS + 1);
    rule.height = 6;
    for (let col = 1; col <= this.columns.length; col++) rule.getCell(col).border = { bottom: { style: "medium", color: { argb: COLOR.brand } } };
    this.sheet.getRow(BANNER_ROWS + 2).height = 8;

    const image = logoParaPdf(options.logo ?? null);
    if (image) {
      // Fit in a 56 x 56 box, keeping the image's own proportion.
      const width = image.proporcion >= 1 ? 56 : 56 * image.proporcion;
      const height = image.proporcion >= 1 ? 56 / image.proporcion : 56;
      const extension = options.logo?.tipo === "image/png" ? "png" : "jpeg";
      // exceljs types `buffer` as its own Buffer alias; a Node Buffer is what it reads at runtime.
      const imageId = this.workbook.addImage({ buffer: image.imagen as unknown as ExcelJS.Buffer, extension });
      this.sheet.addImage(imageId, { tl: { col: 0.15, row: 0.3 }, ext: { width, height }, editAs: "oneCell" });
    }
  }

  private writeHeader(): void {
    const row = this.sheet.getRow(HEADER_ROW);
    row.height = 24;
    this.columns.forEach((column, index) => {
      const cell = row.getCell(index + 1);
      cell.value = column.header;
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: COLOR.white } };
      cell.fill = solidFill(COLOR.primary);
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = { left: thinBorder(COLOR.primary), right: thinBorder(COLOR.primary) };
    });
    this.sheet.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW, column: this.columns.length } };
  }

  /** Every cell of the table's width, including trailing empty ones (`Row.eachCell` stops at the last value). */
  private forEachCell(row: ExcelJS.Row, apply: (cell: ExcelJS.Cell) => void): void {
    for (let col = 1; col <= this.columns.length; col++) apply(row.getCell(col));
  }

  private mergeAcross(rowNumber: number): void {
    if (this.columns.length > 1) this.sheet.mergeCells(rowNumber, 1, rowNumber, this.columns.length);
  }
}
