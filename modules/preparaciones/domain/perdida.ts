/**
 * "Registrar pérdida" on a reserved ítem (openspec/specs/reserva-stock-preparacion/spec.md):
 * the ajuste motivos a loss during the preparación can have (a subset of
 * modules/stock/domain/partida.ts's MOTIVOS_AJUSTE). Pure, no I/O, so the
 * form (a Client Component) and the command share it.
 */
export const MOTIVOS_PERDIDA = ["ROTURA", "DERRAME"] as const;

export type MotivoPerdida = (typeof MOTIVOS_PERDIDA)[number];
