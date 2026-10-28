/**
 * Initial numbering of the open libros (migration 0097, INV-L26, openspec/specs/libro-recetario-y-contralor/spec.md
 * "Numeración inicial"). Raw SQL: the columns are written only by `fsj.libro_configurar_numeracion` and
 * `fsj.cierre_diario_firmar`.
 */
import type { Prisma } from "@/generated/prisma/client";

export interface NumeracionLibroRow {
  libroId: string;
  tipo: "RECETARIO" | "PSICOTROPICO" | "ESTUPEFACIENTE";
  numeroInicial: string;
  /** Jornada of the cierre that fixed the numbering, or null while it can still change. */
  fijadaEnJornada: string | null;
  tieneReanclaje: boolean;
  /** A libro contralor of a tenant that has not activated the digital contralor: kept on paper, nothing to number. */
  contralorManual: boolean;
  cantidadAsientos: number;
  primerNumero: string | null;
  ultimoNumero: string | null;
}

export async function listNumeracionLibros(tx: Prisma.TransactionClient, tenantId: string): Promise<NumeracionLibroRow[]> {
  return tx.$queryRaw<NumeracionLibroRow[]>`
    SELECT l.id::text AS "libroId", l.tipo::text AS tipo, l.numero_inicial::text AS "numeroInicial",
           c.fecha::text AS "fijadaEnJornada",
           EXISTS (SELECT 1 FROM fsj.libro_reanclaje r WHERE r.tenant_id = l.tenant_id AND r.libro_id = l.id) AS "tieneReanclaje",
           (l.tipo <> 'RECETARIO' AND t.fecha_activacion_contralor IS NULL) AS "contralorManual",
           count(a.numero_correlativo)::int AS "cantidadAsientos",
           min(a.numero_correlativo)::text AS "primerNumero",
           max(a.numero_correlativo)::text AS "ultimoNumero"
    FROM fsj.libro_rubricado l
    JOIN fsj.tenant t ON t.id = l.tenant_id
    LEFT JOIN fsj.cierre_diario c ON c.tenant_id = l.tenant_id AND c.id = l.numeracion_fijada_cierre_id
    LEFT JOIN (
      SELECT libro_id, numero_correlativo FROM fsj.asiento_recetario WHERE tenant_id = ${tenantId}::uuid
      UNION ALL
      SELECT libro_id, numero_correlativo FROM fsj.asiento_contralor WHERE tenant_id = ${tenantId}::uuid
    ) a ON a.libro_id = l.id
    WHERE l.tenant_id = ${tenantId}::uuid AND l.fecha_cierre IS NULL
    GROUP BY l.id, l.tipo, l.numero_inicial, c.fecha, t.fecha_activacion_contralor
    ORDER BY l.tipo
  `;
}

/** `fsj.libro_configurar_numeracion`: renumbers the libro's asientos and its chain; the DB refuses a fixed libro. */
export async function configurarNumeracionDb(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; libroId: string; numeroInicial: string },
): Promise<{ numeroInicialAnterior: string; asientosRenumerados: number }> {
  const rows = await tx.$queryRaw<{ numeroInicialAnterior: string; asientosRenumerados: number }[]>`
    SELECT numero_inicial_anterior::text AS "numeroInicialAnterior", asientos_renumerados AS "asientosRenumerados"
    FROM fsj.libro_configurar_numeracion(${input.tenantId}::uuid, ${input.libroId}::uuid, ${input.numeroInicial}::bigint)
  `;
  const fila = rows[0];
  if (!fila) throw new Error("configurarNumeracionDb: fsj.libro_configurar_numeracion returned no row");
  return fila;
}
