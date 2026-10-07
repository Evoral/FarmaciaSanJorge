/**
 * The droga Historial reads recetas and (optionally) paciente names: its source
 * must never log them (docs/specs/historial-droga.md: "No logging of free-text
 * fields or paciente data"). Same source scan as the proveedor Trayectoria.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const files = [
  "modules/drogas/domain/historial.ts",
  "modules/drogas/infrastructure/historial-repository.ts",
  "modules/drogas/application/get-historial-droga.ts",
  "modules/drogas/ui/historial-encabezado.tsx",
  "modules/drogas/ui/historial-receta-fila.tsx",
  "modules/drogas/ui/historial-filtro-partidas.tsx",
  "app/(app)/catalogos/drogas/droga-tabs.tsx",
  "app/(app)/catalogos/drogas/[id]/layout.tsx",
  "app/(app)/catalogos/drogas/[id]/historial/page.tsx",
];

describe("privacy: the droga historial's source never logs", () => {
  for (const file of files) {
    it(`${file} has no logger or console call`, () => {
      const source = readFileSync(path.resolve(__dirname, "../..", file), "utf8");
      expect(source).not.toMatch(/getLogger|shared\/logging|\blogger\.\w+\(|console\./);
    });
  }
});
