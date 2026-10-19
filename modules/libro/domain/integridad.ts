/** Labels and copy for the integrity check of the libros (`/libro/integridad`, the layout aviso). */

export const TIPO_LIBRO_LABELS: Record<string, string> = {
  RECETARIO: "Libro recetario",
  PSICOTROPICO: "Libro contralor de psicotrópicos",
  ESTUPEFACIENTE: "Libro contralor de estupefacientes",
};

export function etiquetaLibro(tipo: string): string {
  return TIPO_LIBRO_LABELS[tipo] ?? tipo;
}
