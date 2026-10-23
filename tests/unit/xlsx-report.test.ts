/** Unit tests for `shared/xlsx/xlsx-report.ts`: branded banner, typed cells (dates, numbers), styling, and formula safety. Each workbook is written and read back with exceljs. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { XlsxReport, toCellValue, toExcelWallClock, type XlsxReportOptions } from "@/shared/xlsx/xlsx-report";

const OPTIONS: XlsxReportOptions = {
  farmacia: "Farmacia Ejemplo",
  title: "Kardex de movimientos de stock",
  description: "Movimientos de stock de cada lote: ingresos por compra, egresos por preparación y ajustes.",
  sheetName: "Kardex",
  issuedAt: new Date("2026-10-14T15:04:05Z"),
  filters: "Tipo: AJUSTE · Fechas: 2026-10-01 a 2026-10-14",
  columns: [
    { header: "Fecha", width: 17, format: "datetime" },
    { header: "Droga", width: 28 },
    { header: "Cantidad", width: 12, format: "decimal" },
    { header: "Vencimiento", width: 12, format: "date" },
  ],
};

async function readBack(report: XlsxReport): Promise<ExcelJS.Worksheet> {
  const workbook = new ExcelJS.Workbook();
  // exceljs types `load`'s input as its own Buffer alias.
  await workbook.xlsx.load((await report.toBuffer()) as unknown as ExcelJS.Buffer);
  return workbook.worksheets[0];
}

describe("toExcelWallClock", () => {
  it("keeps the farmacia's wall-clock time in the UTC fields (UTC-3)", () => {
    expect(toExcelWallClock(new Date("2026-10-14T15:04:05Z"), "America/Argentina/Mendoza").toISOString()).toBe("2026-10-14T12:04:05.000Z");
  });

  it("rolls back the calendar day when it is still the previous day locally", () => {
    expect(toExcelWallClock(new Date("2026-01-01T01:30:00Z"), "America/Argentina/Mendoza").toISOString()).toBe("2025-12-31T22:30:00.000Z");
  });
});

describe("formula injection (audit P4-03)", () => {
  it("quotes text that a spreadsheet would read as a formula, in any column format", () => {
    expect(toCellValue('=HYPERLINK("http://x","y")', "text", "UTC")).toBe(`'=HYPERLINK("http://x","y")`);
    expect(toCellValue("@SUM(A1)", "text", "UTC")).toBe("'@SUM(A1)");
    expect(toCellValue("+54 261", "text", "UTC")).toBe("'+54 261");
    expect(toCellValue("=1+1", "decimal", "UTC")).toBe("'=1+1");
    expect(toCellValue("Pérez", "text", "UTC")).toBe("Pérez");
    expect(toCellValue("-3", "money", "UTC")).toBe(-3);
  });
});

describe("toCellValue", () => {
  const tz = "America/Argentina/Mendoza";

  it("turns decimal strings into numbers in numeric columns", () => {
    expect(toCellValue("12.5000", "decimal", tz)).toBe(12.5);
    expect(toCellValue("-3", "money", tz)).toBe(-3);
    expect(toCellValue("42", "integer", tz)).toBe(42);
  });

  it("keeps a non-numeric value in a numeric column as text instead of dropping it", () => {
    expect(toCellValue("N/D", "decimal", tz)).toBe("N/D");
  });

  it("parses YYYY-MM-DD and UTC-midnight dates as calendar days", () => {
    expect((toCellValue("2026-03-09", "date", tz) as Date).toISOString()).toBe("2026-03-09T00:00:00.000Z");
    expect((toCellValue(new Date("2026-03-09T00:00:00Z"), "date", tz) as Date).toISOString()).toBe("2026-03-09T00:00:00.000Z");
  });

  it("renders empty values as empty cells", () => {
    expect(toCellValue(null, "text", tz)).toBeNull();
    expect(toCellValue(undefined, "decimal", tz)).toBeNull();
    expect(toCellValue("", "date", tz)).toBeNull();
  });
});

describe("XlsxReport", () => {
  it("writes the banner: farmacia name, title, emission date (dd/mm/aaaa hh:mm) and filters", async () => {
    const sheet = await readBack(new XlsxReport(OPTIONS));
    expect(sheet.getCell("B1").value).toBe("Farmacia Ejemplo");
    expect(sheet.getCell("B2").value).toBe("Kardex de movimientos de stock");
    expect(sheet.getCell("B4").value).toBe("Fecha de emisión: 14/10/2026 12:04");
    expect(sheet.getCell("B5").value).toBe("Filtros: Tipo: AJUSTE · Fechas: 2026-10-01 a 2026-10-14");
    expect(sheet.name).toBe("Kardex");
  });

  it("writes the description under the title, italic and wrapped, with a row tall enough for long text", async () => {
    const long = "Saldo físico de cada lote valuado a su costo unitario, con subtotal por droga y total general. ".repeat(3);
    const short = await readBack(new XlsxReport(OPTIONS));
    const tall = await readBack(new XlsxReport({ ...OPTIONS, description: long }));
    expect(short.getCell("B3").value).toBe(OPTIONS.description);
    expect(short.getCell("B3").font?.italic).toBe(true);
    expect(short.getCell("B3").alignment?.wrapText).toBe(true);
    expect(tall.getRow(3).height).toBeGreaterThan(short.getRow(3).height);
  });

  it.each([undefined, "", "   "])("writes 'Sin filtros' when the filter summary is %j", async (filters) => {
    const sheet = await readBack(new XlsxReport({ ...OPTIONS, filters }));
    expect(sheet.getCell("B5").value).toBe("Filtros: Sin filtros");
  });

  it("puts the tenant's own logo on the sheet, and none without one (logo-farmacia.md R7)", async () => {
    const bytes = readFileSync(path.join(process.cwd(), "public", "logo.png"));
    const conLogo = await readBack(new XlsxReport({ ...OPTIONS, logo: { bytes, tipo: "image/png" } }));
    expect(conLogo.getImages()).toHaveLength(1);
    expect((await readBack(new XlsxReport(OPTIONS))).getImages()).toHaveLength(0);
    expect((await readBack(new XlsxReport({ ...OPTIONS, logo: { bytes, tipo: "image/webp" } }))).getImages()).toHaveLength(0);
  });

  it("writes one column per field under a brand-green header, frozen and with auto-filter", async () => {
    const sheet = await readBack(new XlsxReport(OPTIONS));
    const header = sheet.getRow(8);
    expect([1, 2, 3, 4].map((col) => header.getCell(col).value)).toEqual(["Fecha", "Droga", "Cantidad", "Vencimiento"]);
    expect(header.getCell(1).fill).toMatchObject({ type: "pattern", fgColor: { argb: "FF037A5C" } });
    expect(header.getCell(1).font?.color?.argb).toBe("FFFFFFFF");
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 8 });
    expect(sheet.autoFilter).toBeTruthy();
  });

  it("stores dates and numbers as typed cells with es-AR display formats", async () => {
    const report = new XlsxReport(OPTIONS);
    report.push([new Date("2026-10-14T15:04:05Z"), "Ácido salicílico", "12.5000", "2027-03-31"]);
    const sheet = await readBack(report);
    const row = sheet.getRow(9);
    expect((row.getCell(1).value as Date).toISOString()).toBe("2026-10-14T12:04:05.000Z");
    expect(row.getCell(1).numFmt).toBe("dd/mm/yyyy hh:mm");
    expect(row.getCell(2).value).toBe("Ácido salicílico");
    expect(row.getCell(3).value).toBe(12.5);
    expect(row.getCell(3).type).toBe(ExcelJS.ValueType.Number);
    expect((row.getCell(4).value as Date).toISOString()).toBe("2027-03-31T00:00:00.000Z");
    expect(row.getCell(4).numFmt).toBe("dd/mm/yyyy");
  });

  it("never turns formula-looking user text into a formula", async () => {
    const report = new XlsxReport(OPTIONS);
    report.push([null, "=HYPERLINK(\"http://x\")", null, null]);
    const sheet = await readBack(report);
    const cell = sheet.getRow(9).getCell(2);
    expect(cell.type).toBe(ExcelJS.ValueType.String);
    expect(cell.value).toBe("'=HYPERLINK(\"http://x\")");
  });

  it("stripes every other data row across the full width, including trailing empty cells", async () => {
    const report = new XlsxReport(OPTIONS);
    report.push([null, "a", null, null]);
    report.push([null, "b", null, null]);
    const sheet = await readBack(report);
    expect(sheet.getRow(9).getCell(4).fill).not.toMatchObject({ fgColor: expect.anything() });
    expect(sheet.getRow(10).getCell(4).fill).toMatchObject({ fgColor: { argb: "FFF5F7F7" } });
    expect(report.rowCount).toBe(2);
  });

  it("styles summary rows and does not count them, and merges a note across the table", async () => {
    const report = new XlsxReport(OPTIONS);
    report.push([null, "a", "1", null]);
    report.pushSummary(["TOTAL GENERAL", null, "1", null], "total");
    report.pushNote("TRUNCADO: se alcanzó el máximo.");
    const sheet = await readBack(report);
    expect(sheet.getRow(10).getCell(1).font?.bold).toBe(true);
    expect(sheet.getRow(10).getCell(4).fill).toMatchObject({ fgColor: { argb: "FFDDF3EC" } });
    expect(sheet.getRow(11).getCell(1).value).toBe("TRUNCADO: se alcanzó el máximo.");
    expect(sheet.getRow(11).getCell(4).isMerged).toBe(true);
    expect(report.rowCount).toBe(1);
  });
});
