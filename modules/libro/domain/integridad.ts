/** Labels and copy for the integrity check of the libros (`/libro/integridad`, the layout aviso). */

export const TIPO_LIBRO_LABELS: Record<string, string> = {
  RECETARIO: "Libro recetario",
  PSICOTROPICO: "Libro contralor de psicotrópicos",
  ESTUPEFACIENTE: "Libro contralor de estupefacientes",
};

export function etiquetaLibro(tipo: string): string {
  return TIPO_LIBRO_LABELS[tipo] ?? tipo;
}

/**
 * The raw result of one real chain verification of an open libro: `quiebre` is the first broken asiento number, or
 * `null` when the chain is intact. Fed to the incident registration so an incident can also be closed.
 */
export interface VerificacionLibro {
  libroId: string;
  tipo: "RECETARIO" | "PSICOTROPICO" | "ESTUPEFACIENTE";
  quiebre: string | null;
}
