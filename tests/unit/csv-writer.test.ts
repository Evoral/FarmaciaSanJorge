/** Unit tests for `shared/csv/csv-writer.ts` (FASE 9, M12 point 9.1): RFC 4180 quoting, BOM, and CSV/Excel formula-injection neutralization. */
import { describe, it, expect } from "vitest";
import { buildCsv, csvRow, sanitizeCsvCell, CsvWriter } from "@/shared/csv/csv-writer";

describe("sanitizeCsvCell", () => {
  it("leaves normal text untouched", () => {
    expect(sanitizeCsvCell("Juan Pérez")).toBe("Juan Pérez");
  });

  it.each(["=cmd()", "+1+1", "-1+1", "@SUM(A1)", "\ttab", "\rcr"])("prefixes a leading quote for a formula-injection-shaped cell: %s", (value) => {
    expect(sanitizeCsvCell(value)).toBe(`'${value}`);
  });

  it("a cell that merely CONTAINS one of the risky characters (not as its first char) is left alone", () => {
    expect(sanitizeCsvCell("Fórmula A + Fórmula B")).toBe("Fórmula A + Fórmula B");
  });
});

describe("csvRow (RFC 4180 quoting)", () => {
  it("bare cells with no special characters are left unquoted", () => {
    expect(csvRow(["1", "2026-06-15", "Sistema"])).toBe("1,2026-06-15,Sistema");
  });

  it("a cell containing a comma is wrapped in double quotes", () => {
    expect(csvRow(["Pérez, Juan"])).toBe('"Pérez, Juan"');
  });

  it("a cell containing a double quote has it doubled, then the whole cell is wrapped", () => {
    expect(csvRow(['Dijo "hola"'])).toBe('"Dijo ""hola"""');
  });

  it("a cell containing a line break is wrapped", () => {
    expect(csvRow(["línea1\nlínea2"])).toBe('"línea1\nlínea2"');
  });

  it("null/undefined cells render as empty", () => {
    expect(csvRow([null, undefined, "x"])).toBe(",,x");
  });

  it("a formula-injection cell is BOTH neutralized (leading quote) AND quoted if it also needs RFC 4180 quoting", () => {
    expect(csvRow(["=A1,B1"])).toBe(`"'=A1,B1"`);
  });
});

describe("buildCsv", () => {
  it("starts with a UTF-8 BOM and uses CRLF line breaks", () => {
    const csv = buildCsv(["Nº", "Paciente"], [["1", "Ana"]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("\r\n");
    expect(csv).toBe("﻿Nº,Paciente\r\n1,Ana\r\n");
  });
});

describe("CsvWriter", () => {
  it("accumulates a header then pushed rows, matching buildCsv's output", () => {
    const writer = new CsvWriter(["a", "b"]);
    writer.push(["1", "2"]);
    writer.push(["3", "4"]);
    expect(writer.rowCount).toBe(2);
    expect(writer.toString()).toBe(buildCsv(["a", "b"], [["1", "2"], ["3", "4"]]));
  });
});
