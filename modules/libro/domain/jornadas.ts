/**
 * The libro recetario seen per day (`/libro/dias`, docs/specs/libro-recetario-y-contralor.md, "Libro por día"): only
 * days with at least one asiento are listed -- a day without recetas (weekend, holiday, nobody came) is not a debt.
 * A listed day owes its firma when it is over and still has a VIGENTE asiento without cierre (DP-18d, the same rule
 * as the /cierres pending list).
 */
export type EstadoJornadaLibro = "FIRMADA" | "SIN_FIRMAR" | "EN_CURSO" | "SIN_VIGENTES";

export const ESTADO_JORNADA_LIBRO_LABELS: Record<EstadoJornadaLibro, string> = {
  FIRMADA: "Firmada",
  SIN_FIRMAR: "Sin firmar",
  EN_CURSO: "En curso",
  SIN_VIGENTES: "Sin asientos vigentes",
};

export function estadoJornadaLibro(input: { fecha: string; jornadaActual: string; firmada: boolean; vigentesSinFirmar: number }): EstadoJornadaLibro {
  if (input.firmada) return "FIRMADA";
  // The jornada in progress is signed the day after (DP-18b revised, migration 0075): not a debt yet.
  if (input.fecha >= input.jornadaActual) return "EN_CURSO";
  return input.vigentesSinFirmar > 0 ? "SIN_FIRMAR" : "SIN_VIGENTES";
}
