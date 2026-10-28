/**
 * Outcome values for a recorded help query (CA13).
 *
 * These values MUST match the CHECK constraint in
 * `prisma/migrations/20261028120000_0109_chat_ayuda/migration.sql`:
 *   CONSTRAINT consulta_ayuda_resultado_check CHECK (resultado IN ('respondida', 'fuera_de_opciones', 'error'))
 */
export const RESULTADOS_CONSULTA = [
  "respondida",
  "fuera_de_opciones",
  "error",
] as const;

export type ResultadoConsulta = (typeof RESULTADOS_CONSULTA)[number];
