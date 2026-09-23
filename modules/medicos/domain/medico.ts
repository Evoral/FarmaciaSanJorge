/**
 * Pure domain rules for the médico catalog (M06, FASE 4 point 4.4). DP-23
 * (¿matrícula nacional o provincial? ¿jurisdicción?) is unresolved -- per
 * the task's binding decision, no jurisdiction field is invented. Instead,
 * `matriculaString` normalizes every matrícula the SAME way (trim, collapse
 * internal whitespace to a single space, uppercase) before it is compared
 * or stored, so "MAT-123", " mat-123" and "mat-123  " can never coexist as
 * three different rows under migration 0007's
 * `uq_medico_matricula_vigente` partial unique index -- the narrowest fix
 * that does not require deciding DP-23 first.
 *
 * Deliberately NO matching DB CHECK for this normalization (unlike
 * cuit/cuil/dni) -- see migration 0029's header comment for why
 * (tests/db/catalogos-negocio.test.ts's pre-existing matricula-uniqueness
 * test inserts lowercase, unnormalized matriculas directly via raw SQL on
 * purpose, to test what the DATABASE alone enforces).
 */
import { nonEmptyString } from "@/shared/validation";

/** Trims, collapses runs of whitespace to one space, and uppercases -- see module doc comment. */
function normalizarMatricula(matricula: string): string {
  return matricula.trim().replace(/\s+/g, " ").toUpperCase();
}

export const matriculaString = nonEmptyString.transform(normalizarMatricula);

export { normalizarMatricula };
