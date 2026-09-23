/**
 * Pure display-state resolution for an `asiento_recetario` row (FASE 9, M12
 * point 9.1). No I/O -- takes the already-loaded facts (estado, whether an
 * `anulacion_asiento` row exists, whether a `RECTIFICATIVO` asiento links
 * back to this one) and returns what the UI should show.
 *
 * docs/specs/libro-recetario-y-contralor.md §1 [DEDUCCIÓN]: "un asiento con
 * rectificativo se muestra como 'sin efecto por asiento Nº X', aunque en la
 * base siga VIGENTE" -- the DB never flips `estado` for this case (INV-L18
 * only allows a rectificativo against an asiento whose jornada is already
 * SIGNED, which is mutually exclusive with `anulacion_asiento` requiring an
 * UNSIGNED jornada -- INV-L02/L18 -- so a row can never carry both an
 * anulación AND a rectificativo). ANULADO takes priority over SIN_EFECTO
 * only because they are, by construction, mutually exclusive; the ordering
 * below is defensive, not a real tie-break.
 */

export type EstadoVisualAsiento =
  | { kind: "VIGENTE" }
  | { kind: "ANULADO"; motivo: string; anuladoPorNombre: string; autorizadoPorNombre: string; anuladoEn: Date }
  | { kind: "SIN_EFECTO"; rectificativoNumeroCorrelativo: string };

export interface ResolverEstadoVisualInput {
  estado: "VIGENTE" | "ANULADO";
  anulacion: { motivo: string; anuladoPorNombre: string; autorizadoPorNombre: string; anuladoEn: Date } | null;
  rectificativoNumeroCorrelativo: string | null;
}

export function resolverEstadoVisualAsiento(input: ResolverEstadoVisualInput): EstadoVisualAsiento {
  if (input.estado === "ANULADO" && input.anulacion) {
    return { kind: "ANULADO", ...input.anulacion };
  }
  if (input.rectificativoNumeroCorrelativo !== null) {
    return { kind: "SIN_EFECTO", rectificativoNumeroCorrelativo: input.rectificativoNumeroCorrelativo };
  }
  return { kind: "VIGENTE" };
}

/** Spanish label for `EstadoVisualAsiento`, shared by the list and detail pages. */
export function etiquetaEstadoVisual(estado: EstadoVisualAsiento): string {
  switch (estado.kind) {
    case "VIGENTE":
      return "Vigente";
    case "ANULADO":
      return "Anulado";
    case "SIN_EFECTO":
      return `Sin efecto por asiento Nº ${estado.rectificativoNumeroCorrelativo}`;
  }
}
