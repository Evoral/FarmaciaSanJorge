/**
 * `MotivoDemora` (DP-18c RESUELTA, migration 0039, FASE 10 point 10.1).
 * Hand-written union (not imported from `@/generated/prisma/enums`) so the
 * UI select and the zod schema share ONE list without pulling a Prisma
 * import into this module's `domain/` layer (forbidden -- see
 * eslint.config.mjs's `domainBoundaryPatterns`); `tests/unit` checks this
 * stays in sync with the DB enum, same discipline as
 * `modules/auth/domain/permisos.ts`'s own doc comment about `PERMISO_CODES`.
 */
export const MOTIVO_DEMORA_VALUES = ["AUSENCIA_DT", "FALLA_SISTEMA", "FARMACIA_CERRADA", "OTRO"] as const;

export type MotivoDemoraValue = (typeof MOTIVO_DEMORA_VALUES)[number];

export const MOTIVO_DEMORA_LABELS: Readonly<Record<MotivoDemoraValue, string>> = {
  AUSENCIA_DT: "Ausencia del Director Técnico",
  FALLA_SISTEMA: "Falla del sistema",
  FARMACIA_CERRADA: "Farmacia cerrada",
  OTRO: "Otro (indicar detalle)",
};

export interface ValidarMotivoDemoraInput {
  /** Whether signing `fecha` right now would land outside `plazo_firma_dias` (INV-C18) -- see `../domain/demora.ts#calcularFueraDeTermino`. */
  fueraDeTermino: boolean;
  motivoDemora: MotivoDemoraValue | null;
  motivoDemoraDetalle: string | null;
}

/**
 * App-level, friendly pre-check for INV-C18 (motivo required when fuera de
 * término) and the `cierre_diario_motivo_demora_otro_detalle_check`
 * constraint (OTRO requires a non-empty detalle) -- the DB remains the real
 * backstop for both (`fsj.cierre_diario_firmar` / the CHECK constraint,
 * migrations 0015/0039); this exists only so the UI/application layer can
 * show a clear Spanish message before ever reaching the database.
 */
export function validarMotivoDemoraParaFirma(input: ValidarMotivoDemoraInput): { ok: true } | { ok: false; error: string } {
  if (!input.fueraDeTermino) return { ok: true };
  if (!input.motivoDemora) {
    return { ok: false, error: "La firma está fuera de término: indicá el motivo de la demora." };
  }
  if (input.motivoDemora === "OTRO" && !(input.motivoDemoraDetalle ?? "").trim()) {
    return { ok: false, error: 'Indicá el detalle del motivo cuando elegís "Otro".' };
  }
  return { ok: true };
}
