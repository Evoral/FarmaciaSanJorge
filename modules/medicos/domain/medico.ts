/**
 * Pure domain rules for the médico catalog (M06, FASE 4 point 4.4). DP-23
 * is resolved (docs/specs/importacion-receta-pdf.md, migration 0049): a
 * matrícula belongs to a jurisdiction (NACIONAL/PROVINCIAL), and
 * uniqueness among vigente médicos is per (jurisdicción, matrícula).
 * `matriculaString` normalizes every matrícula the SAME way (trim, collapse
 * internal whitespace to a single space, uppercase) before it is compared
 * or stored, so "MAT-123", " mat-123" and "mat-123  " can never coexist as
 * three different rows of the same jurisdiction under
 * `uq_medico_matricula_vigente`.
 *
 * Deliberately NO matching DB CHECK for this normalization (unlike
 * cuit/cuil/dni) -- see migration 0029's header comment for why
 * (tests/db/catalogos-negocio.test.ts's pre-existing matricula-uniqueness
 * test inserts lowercase, unnormalized matriculas directly via raw SQL on
 * purpose, to test what the DATABASE alone enforces).
 */
import { z } from "zod";
import { nonEmptyString } from "@/shared/validation";

export type JurisdiccionMatricula = "NACIONAL" | "PROVINCIAL";

export const JURISDICCIONES_MATRICULA = ["PROVINCIAL", "NACIONAL"] as const satisfies readonly JurisdiccionMatricula[];

export const JURISDICCION_MATRICULA_LABELS: Readonly<Record<JurisdiccionMatricula, string>> = {
  PROVINCIAL: "Provincial",
  NACIONAL: "Nacional",
};

/** "MP 1234" / "MN 1234" -- the usual Argentine shorthand, for lists and headers. */
export function formatMatricula(jurisdiccion: JurisdiccionMatricula, matricula: string): string {
  return `${jurisdiccion === "NACIONAL" ? "MN" : "MP"} ${matricula}`;
}

export const jurisdiccionMatricula = z.enum(JURISDICCIONES_MATRICULA, "Elegí la jurisdicción de la matrícula (provincial o nacional).");

/** Trims, collapses runs of whitespace to one space, and uppercases -- see module doc comment. */
function normalizarMatricula(matricula: string): string {
  return matricula.trim().replace(/\s+/g, " ").toUpperCase();
}

export const matriculaString = nonEmptyString.transform(normalizarMatricula);

export { normalizarMatricula };
