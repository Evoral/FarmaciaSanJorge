/**
 * Guard: every `entidad: "..."` the code audits must have a human label in
 * modules/auditoria/domain/presentacion.ts#ENTIDADES -- otherwise /auditoria
 * shows the raw code ("lote_archivo_recetas") in the sentence and the
 * entidad filter dropdown silently misses it.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ENTIDADES } from "@/modules/auditoria/domain/presentacion";

const ROOT = path.resolve(__dirname, "../..");
const SCAN_DIRS = ["modules", "shared", "app"];
const ENTIDAD_LITERAL = /\bentidad:\s*"([a-z_]+)"/g;

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("auditoria ENTIDADES catalog", () => {
  const usadas = new Map<string, string>();
  for (const file of SCAN_DIRS.flatMap((d) => listSourceFiles(path.join(ROOT, d)))) {
    for (const match of fs.readFileSync(file, "utf8").matchAll(ENTIDAD_LITERAL)) {
      usadas.set(match[1], path.relative(ROOT, file));
    }
  }

  it("finds audited entidades in the sources", () => {
    expect(usadas.size).toBeGreaterThan(10);
  });

  it("labels every audited entidad", () => {
    const sinEtiqueta = [...usadas].filter(([entidad]) => !(entidad in ENTIDADES)).map(([entidad, file]) => `${entidad} (${file})`);
    expect(sinEtiqueta).toEqual([]);
  });
});
